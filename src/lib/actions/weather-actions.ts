"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRealProfile } from "@/lib/data/team";
import { canRunJobs, isOwnerLevel } from "@/lib/roles";
import { applyChain, loadWeatherOpsSettings, notifyPendingReschedules, runWeatherCascade } from "@/lib/data/weather-cascade";
import type { PlannedMove, WorkType } from "@/lib/weather-cascade/rules";

/**
 * The weather panel's buttons: the switches, and the decision on a proposed
 * rain delay. Switches are the owner's; applying or dismissing a delay is
 * the project lead's call as well, because it is how their week runs.
 */

export type WeatherActionResult = { ok: true; message: string } | { ok: false; error: string };

const untyped = (c: unknown) => c as SupabaseClient;

function refresh() {
  revalidatePath("/v2", "layout");
  revalidatePath("/evaluations");
  revalidatePath("/my-day");
}

export interface WeatherSettingsInput {
  cascadeEnabled: boolean;
  autoApply: boolean;
  maxAutoShiftDays: number;
  maxAutoMoves: number;
  workWeekdays: number[];
  mowRainIn: number;
  installRainIn: number;
  rainChanceMin: number;
  heavyRainIn: number;
  saturatedDays: number;
  notifyClients: boolean;
  notifyCrew: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

export async function saveWeatherSettings(input: WeatherSettingsInput): Promise<WeatherActionResult> {
  const me = await getRealProfile();
  if (!me || !isOwnerLevel(me.roles)) return { ok: false, error: "Only an owner can change the weather settings." };
  const supabase = untyped(await createClient());
  const current = await loadWeatherOpsSettings(supabase, me.organization_id);
  if (!current.ready) return { ok: false, error: "The weather tables aren't set up yet. Ask for migration 0359 to be applied." };

  const now = new Date().toISOString();
  const weekdays = [...new Set(input.workWeekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  const { error } = await supabase.from("weather_ops_settings").upsert(
    {
      organization_id: me.organization_id,
      cascade_enabled: input.cascadeEnabled,
      // Recorded the first time it goes on, and never moved after: it is
      // the line between work the cascade may touch and work it may not.
      cascade_started_at: current.cascadeStartedAt ?? (input.cascadeEnabled ? now : null),
      auto_apply: input.autoApply,
      max_auto_shift_days: Math.round(clamp(input.maxAutoShiftDays, 1, 14)),
      max_auto_moves: Math.round(clamp(input.maxAutoMoves, 1, 200)),
      work_weekdays: weekdays.length > 0 ? weekdays : [1, 2, 3, 4, 5],
      mow_rain_in: clamp(input.mowRainIn, 0.01, 5),
      install_rain_in: clamp(input.installRainIn, 0.01, 5),
      rain_chance_min: Math.round(clamp(input.rainChanceMin, 0, 100)),
      heavy_rain_in: clamp(input.heavyRainIn, 0.01, 10),
      saturated_days: Math.round(clamp(input.saturatedDays, 0, 3)),
      notify_clients: input.notifyClients,
      notify_crew: input.notifyCrew,
      updated_at: now,
      updated_by: me.id,
    },
    { onConflict: "organization_id" }
  );
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, message: input.cascadeEnabled ? "Saved. The next check runs within three hours." : "Saved. The cascade is off." };
}

/**
 * The one-off: let the cascade move work that was already on the calendar
 * before it was switched on. An explicit decision, because it is the one
 * thing that touches the backlog.
 */
export async function setCoverExisting(on: boolean): Promise<WeatherActionResult> {
  const me = await getRealProfile();
  if (!me || !isOwnerLevel(me.roles)) return { ok: false, error: "Only an owner can decide that." };
  const supabase = untyped(await createClient());
  const { error } = await supabase
    .from("weather_ops_settings")
    .upsert({ organization_id: me.organization_id, cover_existing: on, updated_at: new Date().toISOString(), updated_by: me.id }, { onConflict: "organization_id" });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, message: on ? "Work already booked will be moved for weather too." : "Only work booked from now on will be moved." };
}

/** Run the check now rather than waiting for the next three-hourly run. */
export async function runWeatherCheckNow(): Promise<WeatherActionResult> {
  const me = await getRealProfile();
  if (!me || !isOwnerLevel(me.roles)) return { ok: false, error: "Only an owner can run the check by hand." };
  try {
    const r = await runWeatherCascade(me.organization_id);
    refresh();
    if (r.skipped) return { ok: true, message: r.skipped };
    if (r.forecastError) return { ok: false, error: `The forecast couldn't be reached: ${r.forecastError}` };
    return { ok: true, message: `Checked ${r.sessionsRead} visits: ${r.applied} moved, ${r.proposed} waiting for you, ${r.stuck} with nowhere to go.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The check failed." };
  }
}

interface ProposalRow {
  id: string;
  organization_id: string;
  work_session_id: string;
  job_id: string;
  chain_key: string;
  run_key: string;
  from_starts_on: string;
  from_ends_on: string;
  to_starts_on: string;
  to_ends_on: string;
  work_type: string;
  cause: "weather" | "chain";
  reason: string;
  exception_id: string | null;
}

async function proposalRows(supabase: SupabaseClient, ids: string[]): Promise<ProposalRow[]> {
  const { data } = await supabase
    .from("weather_reschedules")
    .select("id, organization_id, work_session_id, job_id, chain_key, run_key, from_starts_on, from_ends_on, to_starts_on, to_ends_on, work_type, cause, reason, exception_id")
    .in("id", ids)
    .eq("status", "proposed");
  return (data ?? []) as ProposalRow[];
}

async function resolveExceptions(supabase: SupabaseClient, exceptionIds: (string | null)[], resolution: string, by: string) {
  const ids = [...new Set(exceptionIds.filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  await supabase
    .from("job_exceptions")
    .update({ state: "resolved", resolution, resolved_by: by, resolved_at: now, updated_at: now })
    .in("id", ids)
    .in("state", ["reported", "acknowledged"]);
}

/** Make a proposed chain of moves: all of it, latest day first. */
export async function applyWeatherProposal(ids: string[]): Promise<WeatherActionResult> {
  const me = await getRealProfile();
  if (!me || !canRunJobs(me.roles)) return { ok: false, error: "Only an owner or project lead can move the schedule." };
  const supabase = untyped(await createClient());
  const rows = await proposalRows(supabase, ids);
  if (rows.length === 0) return { ok: false, error: "That proposal has already been decided." };

  const moves: PlannedMove[] = rows.map((r) => ({
    sessionId: r.work_session_id,
    jobId: r.job_id,
    chainKey: r.chain_key,
    workType: r.work_type as WorkType,
    fromStart: r.from_starts_on,
    fromEnd: r.from_ends_on,
    toStart: r.to_starts_on,
    toEnd: r.to_ends_on,
    cause: r.cause,
    reason: r.reason,
    shiftDays: 0,
  }));
  // Through the signed-in client, so the person's own access applies to the
  // visits; the notices go out through the service role as the cron's do.
  const outcome = await applyChain(supabase, me.organization_id, rows[0].run_key, rows[0].chain_key, moves, me.id, new Map(rows.map((r) => [r.work_session_id, r.id])));
  if (outcome.applied > 0) {
    await resolveExceptions(supabase, rows.map((r) => r.exception_id), `Moved for weather by ${me.full_name ?? "the office"}.`, me.id);
    const admin = untyped(createAdminClient());
    const settings = await loadWeatherOpsSettings(admin, me.organization_id);
    await notifyPendingReschedules(admin, me.organization_id, settings).catch(() => null);
  }
  refresh();
  if (outcome.failed > 0) return { ok: false, error: `${outcome.applied} moved, then one couldn't be: ${outcome.failure}` };
  return { ok: true, message: `${outcome.applied} visit${outcome.applied === 1 ? "" : "s"} moved. Clients and crew are being told.` };
}

/** Keep the days as booked. */
export async function dismissWeatherProposal(ids: string[]): Promise<WeatherActionResult> {
  const me = await getRealProfile();
  if (!me || !canRunJobs(me.roles)) return { ok: false, error: "Only an owner or project lead can decide that." };
  const supabase = untyped(await createClient());
  const rows = await proposalRows(supabase, ids);
  if (rows.length === 0) return { ok: false, error: "That proposal has already been decided." };
  const { error } = await supabase
    .from("weather_reschedules")
    .update({ status: "dismissed", applied_by: me.id })
    .in("id", rows.map((r) => r.id));
  if (error) return { ok: false, error: error.message };
  await resolveExceptions(supabase, rows.map((r) => r.exception_id), `Kept as booked by ${me.full_name ?? "the office"}.`, me.id);
  refresh();
  return { ok: true, message: "Kept as booked." };
}
