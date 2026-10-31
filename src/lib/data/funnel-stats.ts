import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { funnelStats, isRecordedStep, type FunnelEvent, type FunnelStats } from "@/lib/funnel";
import { readTiers, tierById } from "@/lib/evaluation-tiers";
import type { SizeSource } from "@/lib/spot-sizing";

export interface FunnelOverview {
  days: number;
  stats: FunnelStats;
  /** Money that landed in the window, by what it was for. */
  money: { deposits: { count: number; cents: number }; evaluations: { count: number; cents: number } };
  /** Estimates worked out in the window. */
  estimates: { count: number; averageCents: number | null; averageSpots: number | null; sizedBy: Record<SizeSource, number> };
  /** Anything that could not be read, said plainly. */
  problems: string[];
}

export const FUNNEL_RANGES = [7, 30, 90] as const;

/**
 * The client funnel over the last `days` days, for the admin Funnel page.
 * Read as the signed-in user, so row security keeps it to their business.
 */
export async function getFunnelOverview(days: number): Promise<FunnelOverview> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const problems: string[] = [];

  const [visits, events, estimates, org] = await Promise.all([
    supabase
      .from("booking_visits")
      .select("id, created_at")
      .eq("organization_id", organizationId)
      .eq("agent", "browser")
      .gte("created_at", since)
      .limit(20_000),
    supabase
      .from("funnel_events")
      .select("step, visit_id, job_id, detail, created_at")
      .eq("organization_id", organizationId)
      .gte("created_at", since)
      .limit(50_000),
    supabase
      .from("job_estimates")
      .select("total_cents, spots, sizing, choice, charged_cents, paid_at, created_at")
      .eq("organization_id", organizationId)
      .gte("created_at", since)
      .limit(5_000),
    supabase.from("organizations").select("evaluation_tiers").eq("id", organizationId).maybeSingle(),
  ]);
  if (visits.error) problems.push(`Booking page opens couldn't be read: ${visits.error.message}`);
  if (events.error) problems.push(`The funnel's steps couldn't be read (has migration 0384 been run?): ${events.error.message}`);
  if (estimates.error) problems.push(`Estimates couldn't be read (have migrations 0380 to 0383 been run?): ${estimates.error.message}`);

  const all: FunnelEvent[] = [
    ...(visits.data ?? []).map((v): FunnelEvent => ({ step: "book_opened", visitId: v.id, jobId: null, detail: null, at: v.created_at })),
    ...(events.data ?? []).flatMap((e): FunnelEvent[] =>
      isRecordedStep(e.step) ? [{ step: e.step, visitId: e.visit_id, jobId: e.job_id, detail: e.detail, at: e.created_at }] : []
    ),
  ];
  const tiers = readTiers(org.data?.evaluation_tiers);
  const stats = funnelStats(all, (detail) => (detail === "deposit" ? "Deposit (1/3)" : tierById(tiers, detail)?.name ?? detail));

  const rows = (estimates.data ?? []) as {
    total_cents: number;
    spots: unknown;
    sizing: unknown;
    choice: "deposit" | "evaluation" | null;
    charged_cents: number | null;
    paid_at: string | null;
  }[];
  const paid = rows.filter((r) => r.paid_at);
  const sum = (list: typeof rows) => list.reduce((total, r) => total + (r.charged_cents ?? 0), 0);
  const sizedBy: Record<SizeSource, number> = { traced: 0, ai: 0, history: 0, typical: 0 };
  let spotCount = 0;
  for (const r of rows) {
    spotCount += Array.isArray(r.spots) ? r.spots.length : 0;
    for (const s of Array.isArray(r.sizing) ? r.sizing : []) {
      const source = (s as { source?: string }).source;
      if (source === "traced" || source === "ai" || source === "history" || source === "typical") sizedBy[source] += 1;
    }
  }

  return {
    days,
    stats,
    money: {
      deposits: { count: paid.filter((r) => r.choice === "deposit").length, cents: sum(paid.filter((r) => r.choice === "deposit")) },
      evaluations: { count: paid.filter((r) => r.choice === "evaluation").length, cents: sum(paid.filter((r) => r.choice === "evaluation")) },
    },
    estimates: {
      count: rows.length,
      averageCents: rows.length > 0 ? Math.round(rows.reduce((t, r) => t + r.total_cents, 0) / rows.length) : null,
      averageSpots: rows.length > 0 ? Math.round((spotCount / rows.length) * 10) / 10 : null,
      sizedBy,
    },
    problems,
  };
}
