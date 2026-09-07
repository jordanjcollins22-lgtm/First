import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { assessOps, DEFAULT_TARGETS, type LeverKey, type OpsAssessment, type OpsPulse, type OpsTargets } from "@/lib/ops";

export interface OpsActionRow {
  id: string;
  mode: string;
  budget: number;
  plan: { lever: LeverKey; units: number }[];
  made: number;
  by: string | null;
  note: string | null;
  at: string;
}

export interface OpsState {
  pulse: OpsPulse;
  targets: OpsTargets;
  assessment: OpsAssessment;
  actions: OpsActionRow[];
  /** Whether a row of targets has been saved, or these are the defaults. */
  targetsSaved: boolean;
}

interface TargetsRow {
  evaluations_per_week: number;
  close_rate: number;
  weeks_booked_ahead: number;
  cash_on_hand: number | string | null;
  cash_as_of: string | null;
  cash_floor: number | string | null;
  marketing_share: number;
  auto_ramp: boolean;
  lever_costs: Partial<Record<LeverKey, number>> | null;
}

export function targetsFromRow(row: TargetsRow | null): OpsTargets {
  if (!row) return DEFAULT_TARGETS;
  return {
    evaluationsPerWeek: Number(row.evaluations_per_week),
    closeRate: Number(row.close_rate),
    weeksBookedAhead: Number(row.weeks_booked_ahead),
    cashOnHand: row.cash_on_hand == null ? null : Number(row.cash_on_hand),
    cashAsOf: row.cash_as_of,
    cashFloor: row.cash_floor == null ? null : Number(row.cash_floor),
    marketingShare: Number(row.marketing_share),
    autoRamp: Boolean(row.auto_ramp),
    leverCosts: row.lever_costs ?? {},
  };
}

/**
 * The pulse and what it means, for the panel.
 *
 * The numbers are the kept answer (refreshed every ten minutes with the
 * rest, and by the daily tick); the judgment is made here, on the way out,
 * so a target changed a second ago is judged against at once.
 */
export async function opsState(options: { fresh?: boolean } = {}): Promise<OpsState> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  const [{ data: pulseRaw, error }, { data: targetsRow, error: targetsError }, { data: actionsRaw }] = await Promise.all([
    options.fresh ? supabase.rpc("summary_refresh", { org, the_key: "ops_pulse" }) : supabase.rpc("summary_get", { org, the_key: "ops_pulse" }),
    supabase.from("ops_targets").select("*").eq("organization_id", org).maybeSingle(),
    supabase.rpc("ops_actions_list", { org, n: 5 }),
  ]);
  if (error) throw error;
  if (targetsError) throw targetsError;
  const pulse = pulseRaw as unknown as OpsPulse;
  if (!pulse || !Array.isArray(pulse.weeks)) throw new Error("The pulse has not been computed yet.");
  const targets = targetsFromRow((targetsRow as unknown as TargetsRow | null) ?? null);
  return {
    pulse,
    targets,
    assessment: assessOps(pulse, targets),
    actions: (Array.isArray(actionsRaw) ? actionsRaw : []) as unknown as OpsActionRow[],
    targetsSaved: targetsRow != null,
  };
}
