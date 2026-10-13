"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRealProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { readAutopilotSettings, runAutopilotForJob, evaluateProposal } from "@/lib/data/sales-autopilot";
import { getProductionPricing } from "@/lib/data/production-pricing";
import { goLiveAfterSave } from "@/lib/sales/autopilot";
import { DIVISIONS, type Division } from "@/lib/sales/divisions";
import { mergeBlocker, readRate, type ServiceRow } from "@/lib/sales/service-dedupe";
import { buildGoodBetterBest } from "@/lib/sales/good-better-best";
import type { Database } from "@/lib/supabase/database.types";

/**
 * The owner's controls for the pipeline autopilot: its switches and
 * guardrails, the rate card's gaps, merging duplicate services, and the
 * sales exceptions. Every action checks the person really signed in (not
 * somebody they are viewing as) is owner-level, and returns a result rather
 * than throwing, because these run from buttons inside transitions.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const untyped = (c: unknown) => c as SupabaseClient;

async function owner(): Promise<{ id: string; organizationId: string } | { error: string }> {
  const profile = await getRealProfile();
  if (!profile) return { error: "Sign in first." };
  if (!isOwnerLevel(profile.roles)) return { error: "Only the owner can change this." };
  return { id: profile.id, organizationId: profile.organization_id };
}

function refresh() {
  revalidatePath("/v2", "layout");
  revalidatePath("/pipeline");
}

export interface AutopilotSettingsInput {
  autoApprove: boolean;
  autoSend: boolean;
  /** Percent, 1-99, per division. */
  targets: Record<Division, number>;
  /** Percent, 1-50. */
  tolerancePct: number;
  speedTargetHours: number;
  overdueExceptions: boolean;
  offerOptions: boolean;
  mhicLicense: string;
}

export async function saveAutopilotSettings(input: AutopilotSettingsInput): Promise<ActionResult> {
  const who = await owner();
  if ("error" in who) return { ok: false, error: who.error };
  for (const division of DIVISIONS) {
    const pct = Number(input.targets?.[division]);
    if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return { ok: false, error: `The ${division} margin has to be between 1% and 99%.` };
  }
  const tolerance = Number(input.tolerancePct);
  if (!Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 50) return { ok: false, error: "The formula tolerance has to be between 1% and 50%." };
  const hours = Number(input.speedTargetHours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 72) return { ok: false, error: "The speed target has to be between a few minutes and 72 hours." };

  try {
    const supabase = await createClient();
    const current = await readAutopilotSettings(supabase, who.organizationId);
    if (!current.ready) return { ok: false, error: "Automatic pricing isn't set up in the database yet." };
    const now = new Date();
    const { error } = await untyped(supabase)
      .from("sales_autopilot_settings")
      .upsert(
        {
          organization_id: who.organizationId,
          auto_approve: Boolean(input.autoApprove),
          // Sending is approving and then emailing: it cannot be on alone.
          auto_send: Boolean(input.autoApprove && input.autoSend),
          started_at: goLiveAfterSave(current.startedAt, Boolean(input.autoApprove), now),
          margin_maintenance: Number(input.targets.maintenance) / 100,
          margin_install: Number(input.targets.install) / 100,
          margin_snow: Number(input.targets.snow) / 100,
          margin_irrigation: Number(input.targets.irrigation) / 100,
          formula_tolerance: tolerance / 100,
          speed_target_hours: hours,
          overdue_exceptions: Boolean(input.overdueExceptions),
          overdue_started_at: goLiveAfterSave(current.overdueStartedAt, Boolean(input.overdueExceptions), now),
          offer_options: Boolean(input.offerOptions),
          mhic_license: input.mhicLicense?.trim() || null,
          updated_at: now.toISOString(),
          updated_by: who.id,
        },
        { onConflict: "organization_id" }
      );
    if (error) return { ok: false, error: error.message };
    refresh();
    return { ok: true, message: "Saved." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't save the settings." };
  }
}

/** A rate typed into the rate coverage list. Blank clears it. */
export async function setServiceRate(serviceTypeId: string, rateText: string, costUnit: string): Promise<ActionResult> {
  const who = await owner();
  if ("error" in who) return { ok: false, error: who.error };
  const rate = readRate(rateText ?? "");
  if (Number.isNaN(rate)) return { ok: false, error: "Type the rate in dollars." };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("services")
      .update({ cost: rate, cost_unit: costUnit?.trim() || "flat rate" })
      .eq("organization_id", who.organizationId)
      .eq("service_type_id", serviceTypeId)
      .select("service_type_id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: "That service no longer exists." };
    refresh();
    revalidatePath("/admin/team");
    return { ok: true, message: rate == null ? "Cleared." : "Saved." };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't save that rate." };
  }
}

/**
 * Folds a duplicate service into the one kept. Done in the database in one
 * transaction (migration 0361's merge_services), so the jobs, site maps and
 * options that pointed at it all point at the kept one, or none of them do.
 */
export async function mergeServices(fromId: string, intoId: string): Promise<ActionResult> {
  const who = await owner();
  if ("error" in who) return { ok: false, error: who.error };
  try {
    const supabase = await createClient();
    const { data: rows } = await supabase
      .from("services")
      .select("service_type_id, name, status, cost, cost_unit")
      .eq("organization_id", who.organizationId)
      .in("service_type_id", [fromId, intoId]);
    const read = (id: string): ServiceRow | undefined => {
      const r = (rows ?? []).find((s) => s.service_type_id === id);
      return r ? { serviceTypeId: r.service_type_id, name: r.name, status: r.status, cost: r.cost == null ? null : Number(r.cost), costUnit: r.cost_unit } : undefined;
    };
    const blocker = mergeBlocker(read(fromId), read(intoId));
    if (blocker) return { ok: false, error: blocker };
    const { data, error } = await untyped(supabase).rpc("merge_services", { p_from: fromId, p_into: intoId });
    if (error) return { ok: false, error: error.message };
    const moved = (data ?? {}) as Record<string, number>;
    const total = Object.values(moved).reduce((s, n) => s + (Number(n) || 0), 0);
    refresh();
    revalidatePath("/admin/team");
    return { ok: true, message: `Merged. ${total} reference${total === 1 ? "" : "s"} moved to "${read(intoId)!.name}".` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't merge those." };
  }
}

/** Closes a sales exception by hand: somebody dealt with it another way. */
export async function dismissSalesException(id: string, note: string): Promise<ActionResult> {
  const who = await owner();
  if ("error" in who) return { ok: false, error: who.error };
  const supabase = await createClient();
  const { error } = await untyped(supabase)
    .from("sales_exceptions")
    .update({ state: "dismissed", resolved_at: new Date().toISOString(), resolved_by: who.id, resolution: note?.trim() || "Dismissed." })
    .eq("organization_id", who.organizationId)
    .eq("id", id)
    .eq("state", "open");
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

/** Checks one held proposal again now, after a rate went in. */
export async function recheckProposal(jobId: string): Promise<ActionResult> {
  const who = await owner();
  if ("error" in who) return { ok: false, error: who.error };
  try {
    const outcome = await runAutopilotForJob(createAdminClient(), who.organizationId, jobId);
    refresh();
    if (!outcome) return { ok: false, error: "There is no proposal on that job." };
    if (outcome.action === "hold") return { ok: true, message: `Still held: ${outcome.reasons[0] ?? "outside the guardrails"}` };
    if (outcome.action === "ignore") return { ok: true, message: outcome.why };
    return { ok: true, message: outcome.sent ? "Approved and sent." : `Approved. ${outcome.why}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't check it." };
  }
}

/**
 * Offers the job as Good / Better / Best on a proposal still waiting for
 * approval. Each option is priced from the production rates, so it leaves
 * the same margin as the price it sits beside.
 */
export async function offerGoodBetterBest(jobId: string): Promise<ActionResult> {
  const who = await owner();
  if ("error" in who) return { ok: false, error: who.error };
  try {
    const admin = createAdminClient();
    const settings = await readAutopilotSettings(admin, who.organizationId);
    const evaluation = await evaluateProposal(admin, who.organizationId, jobId, settings);
    if (!evaluation) return { ok: false, error: "There is no proposal on that job." };
    if (evaluation.status !== "needs_approval") return { ok: false, error: "Options can only be added before the proposal goes out." };
    if (!evaluation.lines) return { ok: false, error: evaluation.guardrails.reasons[0] ?? "This proposal isn't priced from the production rates." };
    const pricing = await getProductionPricing(admin, who.organizationId);
    const options = buildGoodBetterBest({ areas: evaluation.lines, equation: pricing.equation, services: evaluation.services, driveMinutesPerDay: evaluation.driveMinutesPerDay });
    if (!options) return { ok: false, error: "The options would be too close to the price to be worth offering." };
    const { error } = await admin
      .from("job_proposals")
      .update({ options: options as unknown as Database["public"]["Tables"]["job_proposals"]["Update"]["options"] })
      .eq("job_id", jobId)
      .eq("organization_id", who.organizationId)
      .eq("status", "needs_approval");
    if (error) return { ok: false, error: error.message };
    refresh();
    return { ok: true, message: `Offered ${options.options.map((o) => o.name).join(" / ")}.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't build the options." };
  }
}
