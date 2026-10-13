import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { contactsFor, quietWindowFor, sendClientMessage } from "@/lib/data/client-messaging";
import { notifyJobTeam } from "@/lib/notifications";
import { STOPS_WORK_BY_DEFAULT } from "@/lib/exceptions";
import { dateKeyIn } from "@/lib/time-zone";
import { log } from "@/lib/log";
import { embedded, embeddedOne } from "@/lib/postgrest";
import {
  addDays,
  applyOrder,
  clientNotice,
  longDay,
  needsApproval,
  planCascade,
  rescheduleDedupeKey,
  workTypeFor,
  type CascadeSession,
  type DayWeather,
  type PlannedMove,
} from "@/lib/weather-cascade/rules";
import { fetchCascadeForecast, locationKeyFor, pointFromKey } from "@/lib/weather-cascade/forecast";
import { cascadeMayMove, weatherOpsFrom, type WeatherOpsSettings } from "@/lib/weather-cascade/settings";

/**
 * The weather cascade, run for one business.
 *
 * Reads the crews' next three weeks, asks the forecast about the next few
 * days at each place they are working, lets the pure rules decide what
 * moves, and then either moves it (inside the limits) or writes it down as
 * a proposal and raises an exception for the project lead. Clients and
 * crews hear about moves that were made, never about proposals.
 *
 * Runs as the service role: the caller is the cron, with nobody signed in.
 * Everything it writes is keyed so that a second run in the same window
 * proposes nothing new and sends nothing twice.
 */

// These tables are newer than the generated types.
const untyped = (c: unknown) => c as SupabaseClient;

/** How far ahead a crew's days are read, so the chain has room to slide. */
const CHAIN_DAYS = 21;
/** How many days of forecast are trusted to move work on. */
const FORECAST_DAYS = 4;

export interface CascadeRunResult {
  organizationId: string;
  skipped?: string;
  sessionsRead: number;
  applied: number;
  proposed: number;
  stuck: number;
  failed: number;
  clientsNotified: number;
  crewNotified: number;
  forecastError?: string;
}

export async function loadWeatherOpsSettings(client: unknown, organizationId: string): Promise<WeatherOpsSettings> {
  const { data, error } = await untyped(client).from("weather_ops_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  return weatherOpsFrom(data as Record<string, unknown> | null, !error);
}

export interface SessionRow {
  id: string;
  job_id: string;
  starts_on: string;
  ends_on: string;
  status: string;
  subcontractor_id: string | null;
  created_at: string;
  updated_at: string;
  jobs: {
    id: string;
    name: string | null;
    status: string;
    assigned_to: string | null;
    properties: { lat: number | null; lng: number | null; address: string | null; customer_id: string | null } | null;
    job_requested_services: { service_type_id: string }[] | null;
  } | null;
}

export interface CrewDays {
  sessions: SessionRow[];
  cascade: CascadeSession[];
}

/**
 * The crews' visits from today through the next three weeks, as the rules
 * see them. Shared by the cron and the weather panel, so the panel's "risky
 * days" are judged exactly as the cascade will judge them.
 */
export async function readCrewDays(client: unknown, organizationId: string, settings: WeatherOpsSettings, today: string): Promise<CrewDays> {
  const sb = untyped(client);
  const until = addDays(today, CHAIN_DAYS);
  const { data: rows, error } = await sb
    .from("job_work_sessions")
    .select(
      "id, job_id, starts_on, ends_on, status, subcontractor_id, created_at, updated_at, " +
        "jobs!inner(id, name, status, assigned_to, properties(lat, lng, address, customer_id), job_requested_services(service_type_id))"
    )
    .eq("organization_id", organizationId)
    .gte("ends_on", today)
    .lte("starts_on", until)
    .not("status", "in", "(cancelled,done)");
  if (error) throw error;

  const sessions = ((rows ?? []) as unknown as SessionRow[]).filter((s) => s.jobs && s.jobs.status !== "cancelled" && s.jobs.status !== "completed");
  if (sessions.length === 0) return { sessions, cascade: [] };

  const jobIds = [...new Set(sessions.map((s) => s.job_id))];
  const [{ data: mowRows }, { data: saltRows }] = await Promise.all([
    sb.from("mow_orders").select("job_id").in("job_id", jobIds),
    sb.from("salt_orders").select("job_id").in("job_id", jobIds),
  ]);
  const mowJobs = new Set((mowRows ?? []).map((r: { job_id: string | null }) => r.job_id));
  const saltJobs = new Set((saltRows ?? []).map((r: { job_id: string | null }) => r.job_id));

  const cascade: CascadeSession[] = sessions.map((s) => {
    const job = s.jobs!;
    const property = embeddedOne(job.properties);
    return {
      id: s.id,
      jobId: s.job_id,
      // A crew is its lead, or the subcontractor, or the job on its own when
      // nobody is named: an unassigned job moves alone.
      chainKey: s.subcontractor_id ? `sub:${s.subcontractor_id}` : job.assigned_to ? `lead:${job.assigned_to}` : `job:${s.job_id}`,
      startsOn: s.starts_on,
      endsOn: s.ends_on,
      workType: workTypeFor(
        embedded(job.job_requested_services).map((r) => r.service_type_id),
        { mowOrder: mowJobs.has(s.job_id), saltOrder: saltJobs.has(s.job_id) }
      ),
      locationKey: locationKeyFor(property?.lat, property?.lng),
      movable: cascadeMayMove(s, settings),
    };
  });
  return { sessions, cascade };
}

/**
 * The forecast at every place with weather-sensitive work, trimmed to the
 * days it is trusted for: beyond them nobody knows, and those days are
 * dropped rather than guessed. Throws when the service does not answer.
 */
export async function forecastFor(sessions: readonly CascadeSession[], today: string): Promise<Map<string, Map<string, DayWeather>>> {
  const keys = new Set<string>();
  for (const s of sessions) {
    if (s.locationKey && (s.workType === "mowing" || s.workType === "install")) keys.add(s.locationKey);
  }
  const weather = await fetchCascadeForecast([...keys].map(pointFromKey), today, FORECAST_DAYS, 2);
  const lastTrusted = addDays(today, FORECAST_DAYS - 1);
  for (const [key, days] of weather) {
    weather.set(key, new Map([...days].filter(([date]) => date <= lastTrusted)));
  }
  return weather;
}

export async function runWeatherCascade(organizationId: string, now = new Date()): Promise<CascadeRunResult> {
  const admin = untyped(createAdminClient());
  const result: CascadeRunResult = { organizationId, sessionsRead: 0, applied: 0, proposed: 0, stuck: 0, failed: 0, clientsNotified: 0, crewNotified: 0 };
  const settings = await loadWeatherOpsSettings(admin, organizationId);
  if (!settings.ready) return { ...result, skipped: "The weather tables are not set up yet." };
  if (!settings.cascadeEnabled) return { ...result, skipped: "The weather cascade is switched off." };

  const today = dateKeyIn(now);
  // A proposal for a day that has passed is no longer a decision anybody can make.
  await admin
    .from("weather_reschedules")
    .update({ status: "superseded" })
    .eq("organization_id", organizationId)
    .eq("status", "proposed")
    .lt("from_starts_on", today);

  const days = await readCrewDays(admin, organizationId, settings, today);
  result.sessionsRead = days.sessions.length;
  if (days.sessions.length === 0) return finish(admin, organizationId, now, result);
  const cascadeSessions = days.cascade;

  let weather: Map<string, Map<string, DayWeather>>;
  try {
    weather = await forecastFor(cascadeSessions, today);
  } catch (err) {
    // No forecast is "move nothing", never "no rain".
    result.forecastError = err instanceof Error ? err.message : String(err);
    return finish(admin, organizationId, now, result);
  }

  const plan = planCascade({
    sessions: cascadeSessions,
    weatherByLocation: weather,
    rules: settings.rules,
    workWeekdays: settings.workWeekdays,
    today,
  });

  const byChain = new Map<string, PlannedMove[]>();
  for (const move of plan.moves) {
    const list = byChain.get(move.chainKey) ?? [];
    list.push(move);
    byChain.set(move.chainKey, list);
  }

  const runKey = `${today}:${now.toISOString().slice(11, 13)}`;
  let appliedSoFar = 0;
  for (const [chainKey, moves] of byChain) {
    const why = needsApproval(moves, { autoApply: settings.autoApply, maxShiftDays: settings.maxAutoShiftDays, maxMoves: settings.maxAutoMoves }, appliedSoFar);
    if (why) {
      result.proposed += await propose(admin, organizationId, runKey, chainKey, moves, why);
      continue;
    }
    const outcome = await applyChain(admin, organizationId, runKey, chainKey, moves, null);
    appliedSoFar += outcome.applied;
    result.applied += outcome.applied;
    result.failed += outcome.failed;
  }

  for (const s of plan.stuck) {
    const raised = await raiseException(admin, organizationId, s.jobId, s.sessionId, "Rain delay: no workable day found", s.reason);
    if (raised) result.stuck += 1;
  }

  const notified = await notifyPendingReschedules(admin, organizationId, settings, now);
  result.clientsNotified = notified.clients;
  result.crewNotified = notified.crew;
  return finish(admin, organizationId, now, result);
}

async function finish(admin: SupabaseClient, organizationId: string, now: Date, result: CascadeRunResult): Promise<CascadeRunResult> {
  await admin
    .from("weather_ops_settings")
    .update({ last_run_at: now.toISOString(), last_run_summary: result })
    .eq("organization_id", organizationId);
  return result;
}

function rowFor(organizationId: string, runKey: string, move: PlannedMove, status: string) {
  return {
    organization_id: organizationId,
    work_session_id: move.sessionId,
    job_id: move.jobId,
    chain_key: move.chainKey,
    run_key: runKey,
    from_starts_on: move.fromStart,
    from_ends_on: move.fromEnd,
    to_starts_on: move.toStart,
    to_ends_on: move.toEnd,
    work_type: move.workType,
    cause: move.cause,
    reason: move.reason,
    status,
  };
}

/**
 * Write the moves down for a person to decide, and tell the project lead.
 *
 * A move proposed before is not proposed again (the unique key), and a new
 * exception is raised only when something new was proposed. An older
 * proposal for the same visit to a different day is superseded: the
 * forecast changed, and the office should see the current answer only.
 */
async function propose(admin: SupabaseClient, organizationId: string, runKey: string, chainKey: string, moves: PlannedMove[], why: string): Promise<number> {
  const { data: inserted } = await admin
    .from("weather_reschedules")
    .upsert(moves.map((m) => rowFor(organizationId, runKey, m, "proposed")), { onConflict: "work_session_id,from_starts_on,to_starts_on", ignoreDuplicates: true })
    .select("id, work_session_id, to_starts_on");
  const fresh = (inserted ?? []) as { id: string; work_session_id: string; to_starts_on: string }[];
  if (fresh.length === 0) return 0;

  for (const row of fresh) {
    await admin
      .from("weather_reschedules")
      .update({ status: "superseded" })
      .eq("work_session_id", row.work_session_id)
      .eq("status", "proposed")
      .neq("id", row.id);
  }

  const lead = moves.find((m) => m.cause === "weather") ?? moves[0];
  const summary = `Rain delay: ${moves.length} visit${moves.length === 1 ? "" : "s"} to move`;
  const detail = [
    `${lead.reason}. Proposed: ${longDay(lead.fromStart)} → ${longDay(lead.toStart)}${moves.length > 1 ? `, and ${moves.length - 1} more of this crew's days slide along` : ""}.`,
    `Not moved automatically: ${why}`,
    "Apply or dismiss it in Operations › Projects › Weather.",
  ].join("\n");
  const exceptionId = await raiseException(admin, organizationId, lead.jobId, lead.sessionId, summary, detail);
  if (exceptionId) {
    await admin
      .from("weather_reschedules")
      .update({ exception_id: exceptionId })
      .in("id", fresh.map((r) => r.id));
  }
  log.info("weather_cascade.proposed", { organizationId, chainKey, moves: fresh.length });
  return fresh.length;
}

/**
 * An exception for the project lead, once per visit while one is open.
 * Returns its id, or null when one was already open (or it could not be made).
 */
async function raiseException(admin: SupabaseClient, organizationId: string, jobId: string, sessionId: string, summary: string, detail: string): Promise<string | null> {
  const { data: open } = await admin
    .from("job_exceptions")
    .select("id")
    .eq("work_session_id", sessionId)
    .eq("kind", "weather_interruption")
    .in("state", ["reported", "acknowledged"])
    .limit(1);
  if ((open ?? []).length > 0) return null;
  const { data, error } = await admin
    .from("job_exceptions")
    .insert({
      organization_id: organizationId,
      job_id: jobId,
      work_session_id: sessionId,
      kind: "weather_interruption",
      summary,
      detail,
      blocks_work: STOPS_WORK_BY_DEFAULT.weather_interruption,
      reported_by: null,
    })
    .select("id")
    .single();
  if (error) {
    log.error("weather_cascade.exception_failed", error, { organizationId, jobId });
    return null;
  }
  return (data as { id: string }).id;
}

/**
 * Move one crew's chain. Latest landing first, so a day is always vacated
 * before something moves into it and the double-booking guard never sees two
 * visits on one day. Each update is conditional on the visit still being
 * where the plan found it, so a visit somebody moved by hand in the meantime
 * is left alone.
 */
export async function applyChain(
  admin: SupabaseClient,
  organizationId: string,
  runKey: string,
  chainKey: string,
  moves: PlannedMove[],
  appliedBy: string | null,
  existingRowIds?: Map<string, string>
): Promise<{ applied: number; failed: number; failure: string | null }> {
  let applied = 0;
  let failed = 0;
  let failure: string | null = null;
  for (const move of applyOrder(moves)) {
    const { data, error } = await admin
      .from("job_work_sessions")
      .update({ starts_on: move.toStart, ends_on: move.toEnd })
      .eq("id", move.sessionId)
      .eq("starts_on", move.fromStart)
      .eq("status", "scheduled")
      .select("id");
    const ok = !error && (data ?? []).length > 0;
    const status = ok ? "applied" : "failed";
    const why = error ? error.message : ok ? null : "The visit had already been moved or started.";
    const patch = { status, applied_at: ok ? new Date().toISOString() : null, applied_by: appliedBy, failure: why };
    const existing = existingRowIds?.get(move.sessionId);
    if (existing) {
      await admin.from("weather_reschedules").update(patch).eq("id", existing);
    } else {
      await admin
        .from("weather_reschedules")
        .upsert({ ...rowFor(organizationId, runKey, move, status), ...patch }, { onConflict: "work_session_id,from_starts_on,to_starts_on" });
    }
    if (ok) {
      applied += 1;
    } else {
      failed += 1;
      failure = why;
      // Stop the chain here: the moves still to make land on days the ones
      // already made have just freed, and the failed visit is still in the way.
      log.warn("weather_cascade.move_failed", { organizationId, chainKey, sessionId: move.sessionId, why });
      await raiseException(
        admin,
        organizationId,
        move.jobId,
        move.sessionId,
        "Rain delay: a move couldn't be made",
        `Tried to move this visit from ${longDay(move.fromStart)} to ${longDay(move.toStart)} (${move.reason}) but: ${why}`
      );
      break;
    }
  }
  return { applied, failed, failure };
}

/**
 * Tell clients and crews about moves that were made and not yet told.
 *
 * Retried every run until each has gone or been definitively skipped: a
 * text held for quiet hours goes out on the first run after they end. Only
 * moves still in the future are worth telling anybody about.
 */
export async function notifyPendingReschedules(
  admin: SupabaseClient,
  organizationId: string,
  settings: WeatherOpsSettings,
  now = new Date()
): Promise<{ clients: number; crew: number }> {
  const today = dateKeyIn(now);
  const { data } = await admin
    .from("weather_reschedules")
    .select("id, job_id, work_session_id, from_starts_on, to_starts_on, cause, clients_notified_at, crew_notified_at")
    .eq("organization_id", organizationId)
    .eq("status", "applied")
    .gte("to_starts_on", today)
    .or("clients_notified_at.is.null,crew_notified_at.is.null")
    .order("from_starts_on", { ascending: true });
  const rows = (data ?? []) as {
    id: string;
    job_id: string;
    work_session_id: string;
    from_starts_on: string;
    to_starts_on: string;
    cause: "weather" | "chain";
    clients_notified_at: string | null;
    crew_notified_at: string | null;
  }[];
  if (rows.length === 0) return { clients: 0, crew: 0 };

  // One message per job: a job with two visits moved is one text.
  const byJob = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byJob.get(row.job_id) ?? [];
    list.push(row);
    byJob.set(row.job_id, list);
  }

  const { data: org } = await admin.from("organizations").select("name, reminder_quiet_start, reminder_quiet_end, reminder_time_zone").eq("id", organizationId).maybeSingle();
  const business = (org as { name?: string } | null)?.name || "JS Landscaping";
  const window = quietWindowFor((org ?? {}) as Parameters<typeof quietWindowFor>[0]);

  const { data: jobs } = await admin.from("jobs").select("id, name, properties(customer_id, address)").in("id", [...byJob.keys()]);
  const customerByJob = new Map<string, { customerId: string | null; address: string | null; name: string | null }>();
  for (const job of (jobs ?? []) as unknown as { id: string; name: string | null; properties: { customer_id: string | null; address: string | null } | null }[]) {
    const property = embeddedOne(job.properties);
    customerByJob.set(job.id, { customerId: property?.customer_id ?? null, address: property?.address ?? null, name: job.name });
  }
  const contacts = await contactsFor([...customerByJob.values()].map((c) => c.customerId).filter((id): id is string => Boolean(id)));

  let clients = 0;
  let crew = 0;
  const stamp = now.toISOString();
  for (const [jobId, list] of byJob) {
    const first = list[0];
    const ids = list.map((r) => r.id);
    const info = customerByJob.get(jobId);

    if (list.some((r) => !r.clients_notified_at)) {
      let done = !settings.notifyClients || !info?.customerId;
      const contact = info?.customerId ? contacts.get(info.customerId) : undefined;
      if (!done && contact) {
        const channel = contact.phone ? "sms" : "email";
        const outcome = await sendClientMessage(
          {
            organizationId,
            customerId: contact.id,
            channel,
            basis: "service",
            kind: "weather_reschedule",
            referenceId: jobId,
            dedupeKey: rescheduleDedupeKey(first.work_session_id, first.from_starts_on, first.to_starts_on, channel),
            subject: `Your visit has moved to ${longDay(first.to_starts_on)}`,
            body: clientNotice({ firstName: contact.name?.split(" ")[0] ?? null, business, fromStart: first.from_starts_on, toStart: first.to_starts_on, cause: first.cause }),
            automatic: true,
          },
          contact,
          window,
          now
        );
        if (outcome.sent) clients += 1;
        // Held for quiet hours or a temporary failure: try again next run.
        done = outcome.sent || (outcome.reason !== "quiet_hours" && outcome.reason !== "failed");
      } else if (!contact) {
        done = true;
      }
      if (done) await admin.from("weather_reschedules").update({ clients_notified_at: stamp }).in("id", ids);
    }

    if (list.some((r) => !r.crew_notified_at)) {
      if (settings.notifyCrew) {
        const where = info?.address || info?.name || "a job";
        await notifyJobTeam(
          jobId,
          "appointment_reminders",
          `Rain delay: ${where} moved from ${longDay(first.from_starts_on)} to ${longDay(first.to_starts_on)}.`,
          { dedupeKey: `weather_reschedule:${first.work_session_id}:${first.from_starts_on}:${first.to_starts_on}` }
        ).catch(() => {});
        crew += 1;
      }
      await admin.from("weather_reschedules").update({ crew_notified_at: stamp }).in("id", ids);
    }
  }
  return { clients, crew };
}

/** The businesses with anything switched on, for the cron. */
export async function organizationsWithWeatherOps(): Promise<{ organizationId: string; cascade: boolean; snow: boolean }[]> {
  const admin = untyped(createAdminClient());
  const { data, error } = await admin
    .from("weather_ops_settings")
    .select("organization_id, cascade_enabled, snow_suggest_enabled")
    .or("cascade_enabled.eq.true,snow_suggest_enabled.eq.true");
  if (error) return [];
  return ((data ?? []) as { organization_id: string; cascade_enabled: boolean; snow_suggest_enabled: boolean }[]).map((r) => ({
    organizationId: r.organization_id,
    cascade: r.cascade_enabled,
    snow: r.snow_suggest_enabled,
  }));
}
