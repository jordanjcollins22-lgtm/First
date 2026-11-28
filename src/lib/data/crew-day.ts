import { createClient } from "@/lib/supabase/server";
import { dateKeyIn } from "@/lib/time-zone";
import { getCurrentProfile } from "@/lib/data/team";
import type { CrewEvent, CrewEventKind, Stop } from "@/lib/crew-day";
import { routeByNearest } from "@/lib/crew-route";
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

/**
 * Today where the crew is, not where the server is.
 *
 * The server runs on UTC, where eight in the evening in Maryland is already
 * tomorrow. The business clock decides what day it is.
 */
export function localDayKey(now: Date = new Date()): string {
  return dateKeyIn(now);
}

/**
 * Everything the Today screen needs.
 *
 * Stops are the visits covering today on jobs assigned to this person. The
 * starting job is the office's stop_order (then when the visit starts, then
 * job id, so the first house never changes on a refresh). After that each
 * next job is the closest one left to the job just finished.
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
        "id, job_id, starts_on, ends_on, status, purpose, stop_order, meet_on_site, jobs(id, assigned_to, status, properties(address, lat, lng, customers(name)))"
      )
      .lte("starts_on", day)
      .gte("ends_on", day)
      .not("status", "in", "(cancelled,done)")
      // A visit given to a subcontractor is on their crew sheet, not our crew's day.
      .is("subcontractor_id", null),
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
    meet_on_site: boolean | null;
    jobs: {
      id: string;
      assigned_to: string | null;
      status: string;
      properties: { address: string; lat: number; lng: number; customers: { name: string } | null } | null;
    } | null;
  };

  const crewEvents = readEvents(events);
  const finishedJobIds = crewEvents.filter((e) => e.kind === "finished_job" && e.jobId).map((e) => e.jobId!);

  const sorted: Stop[] = ((sessions ?? []) as unknown as Row[])
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
      meetOnSite: Boolean(r.meet_on_site),
    }));
  // The office's first stop starts the day; after that the crew always goes
  // to the closest job left from the one they just finished.
  const stops = routeByNearest(sorted, finishedJobIds);

  const upcoming = await upcomingVisits(profile.id, day, myJobs);
  const nextProject = nextUp({
    today: day,
    stops,
    finishedJobIds,
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
    .is("subcontractor_id", null)
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

export interface CrewToday {
  leadId: string | null;
  leadName: string;
  stops: Stop[];
}

/**
 * Every job on today, crew by crew, for the office and for anyone on a crew
 * who wants to see where the others are. A crew is its lead (the job's lead on
 * job_crew, else the job's assigned person). Each crew's list is in the order
 * it works: its first stop, then the closest one left.
 */
export async function getAllCrewsToday(day = localDayKey()): Promise<CrewToday[] | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const supabase = await createClient();

  const { data: sessions, error } = await supabase
    .from("job_work_sessions")
    .select(
      "id, job_id, starts_on, purpose, stop_order, meet_on_site, jobs(id, assigned_to, status, properties(address, lat, lng, customers(name)))"
    )
    .lte("starts_on", day)
    .gte("ends_on", day)
    .not("status", "in", "(cancelled,done)")
    .is("subcontractor_id", null);
  if (error) return null;

  type Row = {
    id: string;
    job_id: string;
    starts_on: string;
    purpose: string | null;
    stop_order: number | null;
    meet_on_site: boolean | null;
    jobs: {
      assigned_to: string | null;
      status: string;
      properties: { address: string; lat: number; lng: number; customers: { name: string } | null } | null;
    } | null;
  };
  const rows = ((sessions ?? []) as unknown as Row[]).filter((r) => r.jobs?.status !== "cancelled" && r.jobs?.status !== "completed");
  if (rows.length === 0) return [];

  const jobIds = [...new Set(rows.map((r) => r.job_id))];
  const { data: leads } = await supabase.from("job_crew").select("job_id, profile_id").eq("is_lead", true).in("job_id", jobIds);
  const leadOf = new Map(((leads ?? []) as { job_id: string; profile_id: string }[]).map((l) => [l.job_id, l.profile_id]));
  const who = (r: Row) => leadOf.get(r.job_id) ?? r.jobs?.assigned_to ?? null;

  const people = [...new Set(rows.map(who).filter((x): x is string => !!x))];
  const { data: profiles } = people.length
    ? await supabase.from("profiles").select("id, first_name, full_name").in("id", people)
    : { data: [] };
  const nameOf = new Map(
    ((profiles ?? []) as { id: string; first_name: string | null; full_name: string | null }[]).map((p) => {
      const n = (p.first_name || (p.full_name ?? "").split(/\s+/)[0] || "").trim();
      return [p.id, n ? n.charAt(0).toUpperCase() + n.slice(1) : "Unnamed"];
    })
  );

  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = who(r) ?? "none";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  return [...groups.entries()]
    .map(([lead, list]) => {
      const sorted = [...list].sort((a, b) => {
        const ao = a.stop_order ?? Number.MAX_SAFE_INTEGER;
        const bo = b.stop_order ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return a.job_id < b.job_id ? -1 : 1;
      });
      const stops: Stop[] = sorted.map((r) => ({
        jobId: r.job_id,
        sessionId: r.id,
        address: r.jobs?.properties?.address ?? "Address missing",
        customerName: r.jobs?.properties?.customers?.name ?? "Client",
        lat: r.jobs?.properties?.lat ?? null,
        lng: r.jobs?.properties?.lng ?? null,
        purpose: r.purpose,
        meetOnSite: Boolean(r.meet_on_site),
      }));
      return {
        leadId: lead === "none" ? null : lead,
        leadName: lead === "none" ? "No crew yet" : nameOf.get(lead) ?? "Unnamed",
        stops: routeByNearest(stops),
      };
    })
    .sort((a, b) => (a.leadId === null ? 1 : b.leadId === null ? -1 : a.leadName.localeCompare(b.leadName)));
}
