import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { env, isSupabaseAdminConfigured } from "@/lib/env";
import { targetsFromRow } from "@/lib/data/ops";
import { assessOps, planForDatabase, type OpsPulse } from "@/lib/ops";
import type { Json } from "@/lib/supabase/database.types";

/**
 * The daily pulse.
 *
 * Once a morning, for every organisation: the numbers are recomputed, judged
 * against the targets, and when they are off and the ramp is set to act on
 * its own, the plan is made into plays. One round a week at most, three days
 * when things are bad, so a slow week does not pile plays on plays before
 * the last round has had time to ring the phone. What the panel shows the
 * office at nine is what this decided at seven.
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  }
  const secret = env.cronSecret;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: orgs, error } = await admin.from("organizations").select("id, name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const report: Record<string, unknown>[] = [];
  for (const org of orgs ?? []) {
    try {
      const [{ data: pulseRaw, error: pulseError }, { data: targetsRow }, { data: last }] = await Promise.all([
        admin.rpc("summary_refresh", { org: org.id, the_key: "ops_pulse" }),
        admin.from("ops_targets").select("*").eq("organization_id", org.id).maybeSingle(),
        admin.from("ops_actions").select("created_at, mode").eq("organization_id", org.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (pulseError) throw pulseError;
      const pulse = pulseRaw as unknown as OpsPulse;
      const targets = targetsFromRow((targetsRow as unknown as Parameters<typeof targetsFromRow>[0]) ?? null);
      const a = assessOps(pulse, targets);
      const entry: Record<string, unknown> = { org: org.name, mode: a.plan.mode, worst: a.worst, budget: a.plan.budget, hold: a.plan.hold };

      const daysSinceLast = last ? (Date.now() - new Date(last.created_at).getTime()) / 86_400_000 : Infinity;
      const dueAgain = a.plan.mode === "all_out" ? daysSinceLast >= 3 : daysSinceLast >= 7;
      if (targets.autoRamp && a.plan.mode !== "steady" && !a.plan.hold && a.plan.actions.length > 0 && dueAgain) {
        const { data, error: rampError } = await admin.rpc("ops_ramp", {
          org: org.id,
          the_mode: a.plan.mode,
          budget: a.plan.budget,
          plan: planForDatabase(a.plan) as unknown as Json,
          by: null,
          note: `The daily pulse: ${a.plan.why}`,
        });
        if (rampError) throw rampError;
        entry.made = (data as { made?: number } | null)?.made ?? 0;
      } else {
        entry.made = 0;
        entry.skipped = !targets.autoRamp ? "auto-ramp is off" : a.plan.mode === "steady" ? "steady" : a.plan.hold ? "holding" : !dueAgain ? "ramped recently" : "nothing to make";
      }
      report.push(entry);
    } catch (err) {
      console.error(`[ops] tick failed for ${org.name}:`, err);
      report.push({ org: org.name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return NextResponse.json({ organisations: report });
}
