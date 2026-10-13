import type { SupabaseClient } from "@supabase/supabase-js";

import { notifyTeamMember } from "@/lib/notifications";
import { dateKeyIn, minutesIn } from "@/lib/time-zone";
import { log } from "@/lib/log";
import {
  OPEN_SESSION_STATUSES,
  finishVerdict,
  isBacklog,
  isUnclosedPastCutoff,
  unclosedSummary,
  type JobDayEvent,
  type SessionLike,
} from "@/lib/ops/session-close";
import { admin, ensureSettings, leadsFor } from "@/lib/data/ops-settings";

/**
 * Work days that close themselves.
 *
 * The crew's "Finished here" closes the visit (closeSessionsOnFinish, called
 * from the tap itself and again by the sweep in case that call failed). A
 * visit still open at the cutoff becomes an exception on the job, routed to
 * its project lead (sweepSessions). The backlog from before go-live is only
 * ever closed by a person (closeBacklogSessions).
 */

/** Raised-by key for the "never closed" exception, so it is raised once per visit. */
export const UNCLOSED_KEY = "auto_close:unclosed";

type SessionRow = { id: string; job_id: string; organization_id: string; starts_on: string; ends_on: string; status: string };

const asSession = (r: SessionRow): SessionLike => ({ id: r.id, jobId: r.job_id, startsOn: r.starts_on, endsOn: r.ends_on, status: r.status });

function liveFromDay(startedAt: string | null): string | null {
  return startedAt ? dateKeyIn(new Date(startedAt)) : null;
}

async function applyVerdicts(
  client: SupabaseClient,
  sessions: SessionRow[],
  eventsByJobDay: Map<string, JobDayEvent[]>,
  leads: Map<string, string>,
  now: Date
): Promise<{ closed: string[]; started: string[] }> {
  const closed: string[] = [];
  const started: string[] = [];
  for (const row of sessions) {
    const s = asSession(row);
    // The latest day in the visit with events decides it.
    const days = [...eventsByJobDay.keys()]
      .filter((k) => k.startsWith(`${row.job_id}|`))
      .map((k) => k.split("|")[1])
      .filter((d) => d >= s.startsOn && d <= s.endsOn)
      .sort();
    const day = days[days.length - 1];
    if (!day) continue;
    const verdict = finishVerdict(s, day, eventsByJobDay.get(`${row.job_id}|${day}`) ?? [], leads.get(row.job_id) ?? null);
    if (verdict === "close") {
      const { error } = await client
        .from("job_work_sessions")
        .update({ status: "done", closed_at: now.toISOString(), close_source: "crew_finished" })
        .eq("id", row.id)
        .in("status", [...OPEN_SESSION_STATUSES]);
      if (!error) {
        closed.push(row.id);
        await resolveUnclosedException(client, row.id, "Closed by the crew's \"Finished here\" tap.");
      }
    } else if (verdict === "in_progress" && row.status === "scheduled") {
      const { error } = await client.from("job_work_sessions").update({ status: "in_progress" }).eq("id", row.id).eq("status", "scheduled");
      if (!error) started.push(row.id);
    }
  }
  return { closed, started };
}

async function resolveUnclosedException(client: SupabaseClient, sessionId: string, resolution: string, by: string | null = null) {
  await client
    .from("job_exceptions")
    .update({ state: "resolved", resolution, resolved_at: new Date().toISOString(), resolved_by: by, updated_at: new Date().toISOString() })
    .eq("work_session_id", sessionId)
    .eq("raised_by", UNCLOSED_KEY)
    .in("state", ["reported", "acknowledged"]);
}

/** Events at these jobs on these days, keyed "jobId|day". */
async function jobDayEvents(client: SupabaseClient, organizationId: string, jobIds: string[], fromDay: string, toDay: string) {
  const out = new Map<string, JobDayEvent[]>();
  if (jobIds.length === 0) return out;
  const { data } = await client
    .from("crew_day_events")
    .select("profile_id, job_id, day, kind, at")
    .eq("organization_id", organizationId)
    .in("job_id", jobIds)
    .gte("day", fromDay)
    .lte("day", toDay)
    .in("kind", ["arrived_job", "finished_job"]);
  for (const e of (data ?? []) as { profile_id: string; job_id: string; day: string; kind: string; at: string }[]) {
    const key = `${e.job_id}|${e.day}`;
    const list = out.get(key) ?? [];
    list.push({ profileId: e.profile_id, kind: e.kind, at: e.at });
    out.set(key, list);
  }
  return out;
}

/**
 * Called right after a crew member taps "Finished here". Best-effort: the tap
 * has already been recorded, and the sweep catches anything this misses.
 */
export async function closeSessionsOnFinish(organizationId: string, jobId: string, day: string): Promise<void> {
  try {
    const client = admin();
    const { settings, ready } = await ensureSettings(organizationId, client);
    if (!ready || !settings.autoCloseEnabled) return;
    const live = liveFromDay(settings.autoCloseStartedAt);
    if (!live || day < live) return;

    const { data } = await client
      .from("job_work_sessions")
      .select("id, job_id, organization_id, starts_on, ends_on, status")
      .eq("organization_id", organizationId)
      .eq("job_id", jobId)
      .lte("starts_on", day)
      .gte("ends_on", day)
      .in("status", [...OPEN_SESSION_STATUSES]);
    const sessions = (data ?? []) as SessionRow[];
    if (sessions.length === 0) return;
    const [events, leads] = await Promise.all([jobDayEvents(client, organizationId, [jobId], day, day), leadsFor([jobId], client)]);
    await applyVerdicts(client, sessions, events, leads, new Date());
  } catch (err) {
    log.error("ops.close_on_finish_failed", err, { organizationId, jobId, day });
  }
}

/**
 * The every-15-minutes pass for one business: catch up any visit the tap
 * should have closed, and turn visits still open past the cutoff into
 * exceptions for the project lead.
 */
export async function sweepSessions(organizationId: string, now: Date = new Date()): Promise<{ closed: number; started: number; raised: number }> {
  const client = admin();
  const { settings, ready } = await ensureSettings(organizationId, client);
  if (!ready || !settings.autoCloseEnabled) return { closed: 0, started: 0, raised: 0 };
  const live = liveFromDay(settings.autoCloseStartedAt);
  if (!live) return { closed: 0, started: 0, raised: 0 };
  const today = dateKeyIn(now);

  const { data } = await client
    .from("job_work_sessions")
    .select("id, job_id, organization_id, starts_on, ends_on, status")
    .eq("organization_id", organizationId)
    .in("status", [...OPEN_SESSION_STATUSES])
    .gte("ends_on", live)
    .lte("starts_on", today);
  const sessions = (data ?? []) as SessionRow[];
  if (sessions.length === 0) return { closed: 0, started: 0, raised: 0 };

  const jobIds = [...new Set(sessions.map((s) => s.job_id))];
  const fromDay = sessions.reduce((min, s) => (s.starts_on < min ? s.starts_on : min), today);
  const [events, leads] = await Promise.all([jobDayEvents(client, organizationId, jobIds, fromDay < live ? live : fromDay, today), leadsFor(jobIds, client)]);
  const { closed, started } = await applyVerdicts(client, sessions, events, leads, now);

  const minutes = minutesIn(now);
  const stillOpen = sessions.filter((s) => !closed.includes(s.id));
  const due = stillOpen.filter((s) =>
    isUnclosedPastCutoff(asSession(s), today, minutes, { cutoffMinutes: settings.unclosedCutoffMinutes, liveFromDay: live })
  );
  let raised = 0;
  if (due.length > 0) {
    const { data: jobs } = await client.from("jobs").select("id, name, property:properties(address)").in("id", [...new Set(due.map((s) => s.job_id))]);
    const addressOf = new Map(
      ((jobs ?? []) as unknown as { id: string; name: string; property: { address: string | null } | null }[]).map((j) => [j.id, j.property?.address || j.name])
    );
    for (const s of due) {
      const anyArrival = [...events.entries()].some(([k, list]) => k.startsWith(`${s.job_id}|`) && list.some((e) => e.kind === "arrived_job"));
      const summary = unclosedSummary({ address: addressOf.get(s.job_id) ?? null, endsOn: s.ends_on, anyArrival });
      const { error } = await client.from("job_exceptions").insert({
        organization_id: organizationId,
        job_id: s.job_id,
        work_session_id: s.id,
        // "Running over" is the project lead's kind in exceptions.ts, which
        // is exactly who should settle a visit that never closed.
        kind: "overrun",
        summary,
        detail: "Raised automatically: the work day was still open at the cutoff.",
        blocks_work: false,
        raised_by: UNCLOSED_KEY,
      });
      // A unique index makes the second insert fail: raised once per visit.
      if (error) continue;
      raised++;
      const lead = leads.get(s.job_id);
      if (lead) {
        await notifyTeamMember(lead, "team_messages", `${summary} Open the job to close it.`, { dedupeKey: `ops-unclosed:${s.id}` }).catch(() => false);
      }
    }
  }
  return { closed: closed.length, started: started.length, raised };
}

export interface BacklogSession {
  id: string;
  jobId: string;
  jobName: string;
  address: string | null;
  startsOn: string;
  endsOn: string;
  status: string;
  /** Evidence the work happened: a finish tap, or the job is completed. */
  finishedTap: boolean;
  jobCompleted: boolean;
}

/** The open past sessions from before go-live, with what the record says about each. */
export async function listBacklogSessions(organizationId: string, now: Date = new Date()): Promise<BacklogSession[]> {
  const client = admin();
  const { settings } = await ensureSettings(organizationId, client);
  const live = liveFromDay(settings.autoCloseStartedAt);
  const today = dateKeyIn(now);
  const { data } = await client
    .from("job_work_sessions")
    .select("id, job_id, organization_id, starts_on, ends_on, status, jobs(name, status, property:properties(address))")
    .eq("organization_id", organizationId)
    .in("status", [...OPEN_SESSION_STATUSES])
    .lt("ends_on", today)
    .order("ends_on", { ascending: true })
    .limit(200);
  type Row = SessionRow & { jobs: { name: string; status: string; property: { address: string | null } | null } | null };
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => isBacklog(asSession(r), today, live));
  if (rows.length === 0) return [];
  const { data: finishes } = await client
    .from("crew_day_events")
    .select("job_id, day")
    .eq("organization_id", organizationId)
    .eq("kind", "finished_job")
    .in("job_id", [...new Set(rows.map((r) => r.job_id))]);
  const finished = new Set(((finishes ?? []) as { job_id: string; day: string }[]).map((f) => `${f.job_id}|${f.day}`));
  return rows.map((r) => {
    let tap = false;
    for (let d = r.starts_on; d <= r.ends_on && !tap; d = nextDay(d)) tap = finished.has(`${r.job_id}|${d}`);
    return {
      id: r.id,
      jobId: r.job_id,
      jobName: r.jobs?.name ?? "Job",
      address: r.jobs?.property?.address ?? null,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      status: r.status,
      finishedTap: tap,
      jobCompleted: r.jobs?.status === "completed",
    };
  });
}

function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * A person closes past sessions in one go. Only ones that are still open and
 * belong to this business; anything that changed since the page loaded is
 * simply not touched.
 */
export async function closeSessionsByPerson(
  organizationId: string,
  sessionIds: string[],
  outcome: "done" | "cancelled",
  by: string,
  source: "lead" | "backlog_review"
): Promise<number> {
  if (sessionIds.length === 0) return 0;
  const client = admin();
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("job_work_sessions")
    .update({
      status: outcome,
      closed_at: now,
      closed_by: by,
      close_source: source,
      ...(outcome === "cancelled" ? { pause_reason: "Closed as not worked in the review of past days." } : {}),
    })
    .eq("organization_id", organizationId)
    .in("id", sessionIds)
    .in("status", [...OPEN_SESSION_STATUSES])
    .select("id");
  if (error) throw error;
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  for (const id of ids) {
    await resolveUnclosedException(client, id, outcome === "done" ? "Closed as done by the project lead." : "Closed as not worked.", by);
  }
  return ids.length;
}
