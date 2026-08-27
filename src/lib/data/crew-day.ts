import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import type { CrewEvent, CrewEventKind, Stop } from "@/lib/crew-day";
import { nextUp, type EarlyStartRequest, type UpcomingVisit } from "@/lib/early-start";

export interface CrewDayData {
  profileId: string;
  day: string;
  stops: Stop[];
  events: CrewEvent[];
  /** The next job booked for a later day, offered once today is finished. */
  nextProject: UpcomingVisit | null;
  /** The ask already sitting against that job, if there is one. */
  earlyStart: EarlyStartRequest | null;
}

/** Today where the crew is, not where the server is. */
export function localDayKey(now: Date = new Date()): string {
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/**
 * Everything the Today screen needs.
 *
 * Stops are the visits covering today on jobs assigned to this person. Ordered
 * by the office's stop_order where it has been set, then by when the visit
 * starts, then by job id — deterministic all the way down, because a crew
 * member being told a different "first house" on each refresh is worse than
 * any particular order.
 */
export async function getCrewDay(day = localDayKey()): Promise<CrewDayData | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();

  // Every job this person is on. Assignment alone is not enough now that a
  // job has a whole crew — the lead is only one of them, and the rest need
  // their stops too.
  const { data: rosterRows } = await supabase
    .from("job_crew")
    .select("job_id")
    .eq("profile_id", profile.id);
  const myJobs = new Set(((rosterRows ?? []) as { job_id: string }[]).map((r) => r.job_id));

  const [{ data: sessions }, { data: events }] = await Promise.all([
    supabase
      .from("job_work_sessions")
      .select(
        "id, job_id, starts_on, ends_on, status, purpose, stop_order, jobs(id, assigned_to, status, properties(address, lat, lng, customers(name)))"
      )
      .lte("starts_on", day)
      .gte("ends_on", day)
      .not("status", "in", "(cancelled,done)"),
    supabase
      .from("crew_day_events")
      .select("kind, job_id, at")
      .eq("profile_id", profile.id)
      .eq("day", day)
      .order("at", { ascending: true }),
  ]);

  type Row = {
    id: string;
    job_id: string;
    starts_on: string;
    purpose: string | null;
    stop_order: number | null;
    jobs: {
      id: string;
      assigned_to: string | null;
      status: string;
      properties: { address: string; lat: number; lng: number; customers: { name: string } | null } | null;
    } | null;
  };

  const stops: Stop[] = ((sessions ?? []) as unknown as Row[])
    // Roster first, with assignment as the fallback so a job that predates the
    // crew table — or an org that has not run 0083 — still reaches somebody.
    .filter((r) => myJobs.has(r.job_id) || r.jobs?.assigned_to === profile.id)
    .filter((r) => r.jobs?.status !== "cancelled" && r.jobs?.status !== "completed")
    .sort((a, b) => {
      // Unordered stops sort after ordered ones rather than jumping to the
      // front, which is what a null would do numerically.
      const ao = a.stop_order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.stop_order ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      if (a.starts_on !== b.starts_on) return a.starts_on < b.starts_on ? -1 : 1;
      return a.job_id < b.job_id ? -1 : 1;
    })
    .map((r) => ({
      jobId: r.job_id,
      sessionId: r.id,
      address: r.jobs?.properties?.address ?? "Address missing",
      customerName: r.jobs?.properties?.customers?.name ?? "Client",
      lat: r.jobs?.properties?.lat ?? null,
      lng: r.jobs?.properties?.lng ?? null,
      purpose: r.purpose,
    }));

  const crewEvents = readEvents(events);
  const upcoming = await upcomingVisits(profile.id, day, myJobs);
  const nextProject = nextUp({
    today: day,
    stops,
    finishedJobIds: crewEvents.filter((e) => e.kind === "finished_job" && e.jobId).map((e) => e.jobId!),
    upcoming,
  });

  return {
    profileId: profile.id,
    day,
    stops,
    events: crewEvents,
    nextProject,
    earlyStart: nextProject ? await latestRequest(nextProject.sessionId) : null,
  };
}

/**
 * Visits booked for this person after today.
 *
 * Bounded to the next few weeks: the crew are being offered something to do
 * with this afternoon, and a job in November is not that. Reading the whole
 * forward schedule to throw nearly all of it away would also mean this query
 * grows with the business while its answer never does.
 */
async function upcomingVisits(
  profileId: string,
  day: string,
  myJobs: Set<string>
): Promise<UpcomingVisit[]> {
  const supabase = await createClient();
  const horizon = new Date(`${day}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + 28);

  const { data } = await supabase
    .from("job_work_sessions")
    .select(
      "id, job_id, starts_on, purpose, jobs(id, assigned_to, status, properties(address, customers(name)))"
    )
    .gt("starts_on", day)
    .lte("starts_on", horizon.toISOString().slice(0, 10))
    .not("status", "in", "(cancelled,done)")
    .order("starts_on", { ascending: true });

  type Row = {
    id: string;
    job_id: string;
    starts_on: string;
    purpose: string | null;
    jobs: {
      assigned_to: string | null;
      status: string;
      properties: { address: string; customers: { name: string } | null } | null;
    } | null;
  };

  return ((data ?? []) as unknown as Row[])
    .filter((r) => myJobs.has(r.job_id) || r.jobs?.assigned_to === profileId)
    .filter((r) => r.jobs?.status !== "cancelled" && r.jobs?.status !== "completed")
    .map((r) => ({
      jobId: r.job_id,
      sessionId: r.id,
      address: r.jobs?.properties?.address ?? "Address missing",
      customerName: r.jobs?.properties?.customers?.name ?? "Client",
      startsOn: r.starts_on,
      purpose: r.purpose,
    }));
}

/** The most recent ask against a visit — pending, approved or turned down. */
async function latestRequest(sessionId: string): Promise<EarlyStartRequest | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("early_start_requests")
    .select("id, session_id, status, requested_for, decline_reason")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    sessionId: data.session_id,
    status: data.status as EarlyStartRequest["status"],
    requestedFor: data.requested_for,
    declineReason: data.decline_reason,
  };
}

function readEvents(rows: unknown): CrewEvent[] {
  return ((rows ?? []) as { kind: string; job_id: string | null; at: string }[]).map((e) => ({
    kind: e.kind as CrewEventKind,
    jobId: e.job_id,
    at: e.at,
  }));
}
