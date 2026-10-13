"use server";

import { revalidatePath } from "next/cache";

import { getRealProfile } from "@/lib/data/team";
import { canRunJobs, isOwnerLevel } from "@/lib/roles";
import { startStamps, SWITCHES, type SettingsRow } from "@/lib/ops/autopilot-settings";
import { admin, ensureSettings } from "@/lib/data/ops-settings";
import { closeSessionsByPerson } from "@/lib/data/ops-sessions";
import { writeCostSnapshot } from "@/lib/data/ops-costing";

/**
 * The writes behind the Projects autopilot and Job costing panels.
 *
 * Settings and money are owner-level. Closing a work day is a project lead's
 * job too, because they were there, so that one takes anybody who may run
 * jobs. Every write is scoped to the caller's own business.
 */

export type OpsResult = { ok: true; message: string } | { ok: false; message: string };

async function owner() {
  const profile = await getRealProfile();
  if (!profile) return null;
  return isOwnerLevel(profile.roles) ? profile : null;
}

async function runner() {
  const profile = await getRealProfile();
  if (!profile) return null;
  return canRunJobs(profile.roles) ? profile : null;
}

function refresh() {
  revalidatePath("/v2", "layout");
  revalidatePath("/operations");
}

/** Only these columns can be written from the panel, each with its type. */
const EDITABLE: Record<string, "boolean" | "number"> = {
  auto_close_enabled: "boolean",
  unclosed_cutoff_minutes: "number",
  completion_chain_enabled: "boolean",
  invoice_after_client_approval: "boolean",
  signoff_overdue_hours: "number",
  over_budget_pct: "number",
  labor_burden_pct: "number",
  checkin_lead_first_enabled: "boolean",
  checkin_escalate_minutes: "number",
  auto_place_enabled: "boolean",
  auto_place_min_notice_days: "number",
  auto_place_daily_cap: "number",
  crew_bonus_enabled: "boolean",
  crew_bonus_per_member_cents: "number",
};

export async function saveAutopilotSettings(patch: Record<string, boolean | number>): Promise<OpsResult> {
  const who = await owner();
  if (!who) return { ok: false, message: "Only the owner changes the autopilot." };
  const clean: SettingsRow = {};
  for (const [key, value] of Object.entries(patch)) {
    const kind = EDITABLE[key];
    if (!kind || typeof value !== kind) continue;
    if (kind === "number" && !Number.isFinite(value)) continue;
    clean[key] = value;
  }
  if (Object.keys(clean).length === 0) return { ok: false, message: "Nothing to save." };

  const db = admin();
  const { ready } = await ensureSettings(who.organization_id, db);
  if (!ready) return { ok: false, message: "The autopilot tables aren't set up yet (migration 0358)." };
  const { data: current } = await db.from("ops_autopilot_settings").select("*").eq("organization_id", who.organization_id).maybeSingle();
  const before = (current ?? {}) as SettingsRow;

  // A switch going from off to on starts again from now, so what piled up
  // while it was off is not swept up.
  const restarted = SWITCHES.filter((s) => clean[s.enabled] === true && before[s.enabled] === false).map((s) => s.enabled);
  const merged = { ...before, ...clean };
  const stamps = startStamps(merged, new Date().toISOString(), restarted);
  const { error } = await db
    .from("ops_autopilot_settings")
    .update({ ...clean, ...stamps, updated_at: new Date().toISOString(), updated_by: who.id })
    .eq("organization_id", who.organization_id);
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  refresh();
  return { ok: true, message: "Saved." };
}

/** The one-click review of past days: close the chosen ones in one go. */
export async function closePastSessions(sessionIds: string[], outcome: "done" | "cancelled"): Promise<OpsResult> {
  const who = await runner();
  if (!who) return { ok: false, message: "Only a project lead, account manager or owner can close work days." };
  if (outcome !== "done" && outcome !== "cancelled") return { ok: false, message: "Pick done or not worked." };
  const ids = [...new Set(sessionIds)].filter((id) => /^[0-9a-f-]{36}$/.test(id)).slice(0, 200);
  if (ids.length === 0) return { ok: false, message: "Pick at least one day." };
  try {
    const n = await closeSessionsByPerson(who.organization_id, ids, outcome, who.id, "backlog_review");
    refresh();
    return { ok: true, message: `Closed ${n} work day${n === 1 ? "" : "s"}.` };
  } catch {
    return { ok: false, message: "Couldn't close those. Try again." };
  }
}

/** A lead settling one "never closed" exception from the strip. */
export async function closeOneSession(sessionId: string, outcome: "done" | "cancelled"): Promise<OpsResult> {
  const who = await runner();
  if (!who) return { ok: false, message: "Only a project lead, account manager or owner can close work days." };
  try {
    const n = await closeSessionsByPerson(who.organization_id, [sessionId], outcome, who.id, "lead");
    refresh();
    return n > 0 ? { ok: true, message: "Closed." } : { ok: false, message: "That day is already closed." };
  } catch {
    return { ok: false, message: "Couldn't close it. Try again." };
  }
}

/** "On it", from the panel rather than the text. */
export async function acknowledgeCheckinAlert(alertId: string): Promise<OpsResult> {
  const who = await runner();
  if (!who) return { ok: false, message: "Not yours to answer." };
  const { error } = await admin()
    .from("crew_checkin_alerts")
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: who.id })
    .eq("id", alertId)
    .eq("organization_id", who.organization_id)
    .is("acknowledged_at", null);
  if (error) return { ok: false, message: "Couldn't save that." };
  refresh();
  return { ok: true, message: "Marked as handled." };
}

/** Take a held job off auto-placement: a person will book it. */
export async function dismissHeldPlacement(jobId: string): Promise<OpsResult> {
  const who = await runner();
  if (!who) return { ok: false, message: "Only a project lead, account manager or owner can do that." };
  const { error } = await admin()
    .from("auto_placements")
    .update({ status: "dismissed", updated_at: new Date().toISOString() })
    .eq("job_id", jobId)
    .eq("organization_id", who.organization_id)
    .eq("status", "held");
  if (error) return { ok: false, message: "Couldn't save that." };
  refresh();
  return { ok: true, message: "Left for a person to book." };
}

/** Work the cost snapshot out again, e.g. after a time entry was corrected. */
export async function recomputeJobCost(jobId: string): Promise<OpsResult> {
  const who = await owner();
  if (!who) return { ok: false, message: "Only the owner sees job costing." };
  const db = admin();
  const { data: row } = await db.from("job_cost_snapshots").select("final").eq("job_id", jobId).eq("organization_id", who.organization_id).maybeSingle();
  const { data: job } = await db.from("jobs").select("status").eq("id", jobId).maybeSingle();
  if (!job) return { ok: false, message: "Couldn't find that job." };
  const { settings } = await ensureSettings(who.organization_id, db);
  try {
    await writeCostSnapshot(who.organization_id, jobId, Boolean((row as { final?: boolean } | null)?.final) || job.status === "completed", settings);
    refresh();
    return { ok: true, message: "Recalculated." };
  } catch {
    return { ok: false, message: "Couldn't recalculate. Try again." };
  }
}

/** Approve the accrued bonus lines for one week, for payroll. */
export async function approveBonusWeek(weekStart: string): Promise<OpsResult> {
  const who = await owner();
  if (!who) return { ok: false, message: "Only the owner approves bonuses." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return { ok: false, message: "That isn't a week." };
  const { data, error } = await admin()
    .from("crew_bonus_weeks")
    .update({ status: "approved" })
    .eq("organization_id", who.organization_id)
    .eq("week_start", weekStart)
    .eq("status", "accrued")
    .gt("amount_cents", 0)
    .select("id");
  if (error) return { ok: false, message: "Couldn't approve. Try again." };
  refresh();
  return { ok: true, message: `Approved ${(data ?? []).length} bonus line${(data ?? []).length === 1 ? "" : "s"}.` };
}
