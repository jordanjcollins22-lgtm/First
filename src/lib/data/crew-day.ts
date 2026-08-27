import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import type { CrewEvent, CrewEventKind, Stop } from "@/lib/crew-day";

export interface CrewDayData {
  profileId: string;
  day: string;
  stops: Stop[];
  events: CrewEvent[];
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

  return { profileId: profile.id, day, stops, events: readEvents(events) };
}

function readEvents(rows: unknown): CrewEvent[] {
  return ((rows ?? []) as { kind: string; job_id: string | null; at: string }[]).map((e) => ({
    kind: e.kind as CrewEventKind,
    jobId: e.job_id,
    at: e.at,
  }));
}
