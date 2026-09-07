"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { opsState } from "@/lib/data/ops";
import { planForDatabase, type LeverKey } from "@/lib/ops";
import type { Json } from "@/lib/supabase/database.types";

/**
 * The few things a person does to the pulse: say what the business wants,
 * enter the cash, and press Do it when the ramp is proposing rather than
 * making.
 */

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

const PAGES = ["/my-day", "/dashboard", "/attractors"];

async function guard<T>(name: string, work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (err) {
    console.error(`[ops] ${name} failed:`, err);
    const e = err as { message?: string; details?: string };
    return { ok: false, error: [e?.message, e?.details].filter(Boolean).join(" ") || String(err) };
  }
}

async function requireUser() {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");
  return profile;
}

export interface TargetsInput {
  evaluationsPerWeek: number;
  closeRate: number;
  weeksBookedAhead: number;
  cashOnHand: number | null;
  cashAsOf: string | null;
  cashFloor: number | null;
  marketingShare: number;
  autoRamp: boolean;
  leverCosts?: Partial<Record<LeverKey, number>>;
}

export async function saveOpsTargets(input: TargetsInput): Promise<ActionResult<null>> {
  return guard("saveOpsTargets", async () => {
    const profile = await requireUser();
    const supabase = await createClient();
    const clean = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
    const { error } = await supabase.from("ops_targets").upsert({
      organization_id: profile.organization_id,
      evaluations_per_week: Math.round(clean(input.evaluationsPerWeek, 1, 200)),
      close_rate: clean(input.closeRate, 0.05, 1),
      weeks_booked_ahead: clean(input.weeksBookedAhead, 0.5, 52),
      cash_on_hand: input.cashOnHand == null ? null : clean(input.cashOnHand, -1e9, 1e9),
      cash_as_of: input.cashOnHand == null ? null : (input.cashAsOf ?? new Date().toISOString().slice(0, 10)),
      cash_floor: input.cashFloor == null ? null : clean(input.cashFloor, 0, 1e9),
      marketing_share: clean(input.marketingShare, 0, 1),
      auto_ramp: Boolean(input.autoRamp),
      lever_costs: (input.leverCosts ?? {}) as unknown as Json,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    // The cash carried forward starts from the day it was entered.
    const { error: refreshError } = await supabase.rpc("summary_refresh", { org: profile.organization_id, the_key: "ops_pulse" });
    if (refreshError) console.error("[ops] pulse refresh after targets:", refreshError.message);
    for (const page of PAGES) revalidatePath(page);
    return null;
  });
}

/** The plan as it stands, made into plays now. */
export async function runRamp(): Promise<ActionResult<{ made: number }>> {
  return guard("runRamp", async () => {
    const profile = await requireUser();
    const state = await opsState({ fresh: true });
    const plan = state.assessment.plan;
    if (plan.mode === "steady") throw new Error("Every signal is on target; there is nothing to ramp.");
    if (plan.hold) throw new Error(plan.hold);
    if (plan.actions.length === 0) throw new Error("No lever pays for itself right now.");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("ops_ramp", {
      org: profile.organization_id,
      the_mode: plan.mode,
      budget: plan.budget,
      plan: planForDatabase(plan) as unknown as Json,
      by: profile.id,
      note: plan.why,
    });
    if (error) throw error;
    const result = (data ?? {}) as { made?: number };
    for (const page of PAGES) revalidatePath(page);
    return { made: result.made ?? 0 };
  });
}

export async function refreshPulse(): Promise<ActionResult<null>> {
  return guard("refreshPulse", async () => {
    const profile = await requireUser();
    const supabase = await createClient();
    const { error } = await supabase.rpc("summary_refresh", { org: profile.organization_id, the_key: "ops_pulse" });
    if (error) throw error;
    for (const page of PAGES) revalidatePath(page);
    return null;
  });
}
