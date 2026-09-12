import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { listWeeklyAvailability, listDaysOff } from "@/lib/data/availability";
import { listProfiles } from "@/lib/data/team";
import { jobStanding } from "@/lib/data/job-readiness";
import { listBoardJobs } from "@/lib/data/job-board";
import { fetchForecasts, isRoughDay, describeWeather } from "@/lib/weather";
import { roleKeysOf } from "@/lib/roles";
import { embedded } from "@/lib/postgrest";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { zoneCrewHours } from "@/lib/proposal-pricing";
import type { WorkZone } from "@/components/canvas/types";
import {
  suggestMoves,
  suggestSchedule,
  type DayCapacity,
  type MoveSuggestion,
  type SchedulableJob,
  type Suggestion,
} from "@/lib/schedule-engine";

/**
 * Everything the scheduling engine needs, gathered once.
 *
 * The engine itself is pure and knows nothing about the database. This is the
 * layer that turns rows into its inputs, and the honest bits of it are the
 * places where it declines to fill a gap: a job with no timing on its services
 * arrives with `hoursKnown: false` rather than with an average, and a property
 * with no coordinates arrives with nulls rather than with the town centre.
 */

/** Services the weather actually stops. Everything else can be done wet. */
const WEATHER_STOPS = ["grading", "hardscape", "patio", "planting", "sod", "seeding", "mulch", "drainage"];

export interface EngineOutput {
  /** False when the business has not switched the engine on. */
  enabled: boolean;
  suggestions: Suggestion[];
  moves: MoveSuggestion[];
  /** Said on the screen when the engine had to work with less than it wanted. */
  caveats: string[];
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function scheduleEngineEnabled(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const org = await getCurrentOrganizationId();
    const { data } = await supabase
      .from("organizations")
      .select("schedule_engine_enabled")
      .eq("id", org)
      .maybeSingle();
    return Boolean(data?.schedule_engine_enabled);
  } catch {
    return false;
  }
}

/**
 * What the engine would suggest, if the business has asked for it.
 *
 * Returns `enabled: false` and nothing else when the flag is off -- not an
 * empty list, which a screen could mistake for "everything is scheduled".
 */
export async function scheduleSuggestions(): Promise<EngineOutput> {
  const enabled = await scheduleEngineEnabled();
  if (!enabled) return { enabled: false, suggestions: [], moves: [], caveats: [] };

  const supabase = await createClient();
  const today = dateKey(new Date());
  const horizonEnd = dateKey(new Date(Date.now() + 28 * 86_400_000));
  const caveats: string[] = [];

  const [jobRows, sessionRows, crewRows, profiles, weekly, daysOff, locations, standing] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, name, status, project_start_date, created_at, " +
          "properties!inner(address, lat, lng), " +
          "job_requested_services(service_type_id), " +
          "job_proposals(client_chosen_day, status)"
      )
      .eq("status", "approved")
      .limit(200)
      .then((r) => r.data ?? []),
    supabase
      .from("job_work_sessions")
      .select("id, job_id, starts_on, ends_on, status")
      .gte("starts_on", today)
      .lte("starts_on", horizonEnd)
      .then((r) => r.data ?? []),
    supabase.from("job_crew").select("job_id, profile_id").then((r) => r.data ?? []),
    listProfiles().catch(() => []),
    listWeeklyAvailability().catch(() => []),
    listDaysOff(today, horizonEnd).catch(() => []),
    supabase.from("business_locations").select("id, name, lat, lng").then((r) => r.data ?? []),
    listBoardJobs()
      .then((jobs) => jobStanding(jobs))
      .catch(() => null),
  ]);

  // ---------------------------------------------------------------- the crew
  const field = (profiles as unknown as { id: string; full_name: string | null; email: string | null; roles?: string[] }[])
    .filter((p) => {
      const keys = roleKeysOf(p.roles ?? []);
      return keys.includes("project-technician") || keys.includes("project-lead");
    });

  if (field.length === 0) {
    caveats.push("Nobody holds a crew or project lead role, so there is nobody to suggest.");
  }

  const weeklyByPerson = new Map<string, { weekday: number; hours: number }[]>();
  for (const row of weekly as unknown as { profile_id: string; weekday: number; start_time: string | null; end_time: string | null }[]) {
    const list = weeklyByPerson.get(row.profile_id) ?? [];
    const hours =
      row.start_time && row.end_time
        ? Math.max(0, (Date.parse(`1970-01-01T${row.end_time}`) - Date.parse(`1970-01-01T${row.start_time}`)) / 3_600_000)
        : 0;
    list.push({ weekday: row.weekday, hours });
    weeklyByPerson.set(row.profile_id, list);
  }

  const offByPerson = new Map<string, Set<string>>();
  for (const row of daysOff as unknown as { profile_id: string; date: string }[]) {
    const set = offByPerson.get(row.profile_id) ?? new Set<string>();
    set.add(row.date);
    offByPerson.set(row.profile_id, set);
  }

  // Hours a person already owes a job on a given day. A session is a whole
  // day's work in this system, so a person on a session is not free that day.
  const bookedByPerson = new Map<string, Set<string>>();
  const crewByJob = new Map<string, string[]>();
  for (const row of crewRows as unknown as { job_id: string; profile_id: string }[]) {
    const list = crewByJob.get(row.job_id) ?? [];
    list.push(row.profile_id);
    crewByJob.set(row.job_id, list);
  }
  const bookedJobsByDate = new Map<string, string[]>();
  for (const row of sessionRows as unknown as { job_id: string; starts_on: string; ends_on: string; status: string }[]) {
    if (row.status === "cancelled") continue;
    for (let d = new Date(`${row.starts_on}T00:00:00Z`); dateKey(d) <= row.ends_on; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = dateKey(d);
      for (const person of crewByJob.get(row.job_id) ?? []) {
        const set = bookedByPerson.get(person) ?? new Set<string>();
        set.add(key);
        bookedByPerson.set(person, set);
      }
      const jobs = bookedJobsByDate.get(key) ?? [];
      jobs.push(row.job_id);
      bookedJobsByDate.set(key, jobs);
    }
  }

  // -------------------------------------------------------------- the weather
  let roughByDate = new Map<string, string>();
  const points = (locations as unknown as { id: string; name: string; lat: number; lng: number }[]).filter(
    (l) => l.lat != null && l.lng != null
  );
  if (points.length === 0) {
    caveats.push("No business location is set, so no forecast was consulted.");
  } else {
    try {
      const forecasts = await fetchForecasts(points, 16);
      // The worst of the locations: a crew works one metro area, and the
      // pessimistic reading is the one that keeps somebody dry.
      for (const location of forecasts) {
        for (const day of location.days) {
          if (isRoughDay(day) && !roughByDate.has(day.date)) {
            roughByDate.set(
              day.date,
              `${describeWeather(day.code).toLowerCase()}, ${Math.round(day.precipChance)}% chance of rain`
            );
          }
        }
      }
    } catch {
      caveats.push("The forecast could not be reached, so no day was ruled out for weather.");
      roughByDate = new Map();
    }
  }

  // ------------------------------------------------------------------- days
  const days: DayCapacity[] = [];
  for (let i = 0; i <= 28; i += 1) {
    const date = dateKey(new Date(Date.now() + i * 86_400_000));
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const crew = field
      .map((person) => {
        if (offByPerson.get(person.id)?.has(date)) return null;
        if (bookedByPerson.get(person.id)?.has(date)) return null;
        const hours = (weeklyByPerson.get(person.id) ?? []).find((w) => w.weekday === weekday)?.hours ?? 0;
        if (hours <= 0) return null;
        return { profileId: person.id, name: person.full_name || person.email || "Somebody", freeHours: hours };
      })
      .filter((c): c is { profileId: string; name: string; freeHours: number } => c != null);

    days.push({
      date,
      crew,
      booked: (bookedJobsByDate.get(date) ?? []).map((jobId) => {
        const row = (jobRows as unknown as { id: string; properties: { lat: number | null; lng: number | null } | null }[]).find(
          (j) => j.id === jobId
        );
        return { jobId, lat: row?.properties?.lat ?? null, lng: row?.properties?.lng ?? null };
      }),
      rough: roughByDate.has(date),
      roughWhy: roughByDate.get(date) ?? null,
    });
  }

  if ((weekly as unknown[]).length === 0) {
    caveats.push("Nobody has weekly hours set, so no day has any capacity to offer.");
  }

  // ------------------------------------------------------------- the hours
  //
  // Read off the site plan through the same function that prices the job, so
  // the duration the engine schedules against and the duration the client was
  // charged for are the same number. A job whose services carry no timing
  // comes back as not known, and the engine says so on the suggestion rather
  // than quietly assuming a day.
  const hoursByJob = new Map<string, { hours: number; known: boolean }>();
  try {
    const jobIds = (jobRows as unknown as { id: string }[]).map((j) => j.id);
    if (jobIds.length > 0) {
      const [catalog, designs] = await Promise.all([
        getCanvasCatalog(),
        supabase.from("canvas_designs").select("job_id, zones").in("job_id", jobIds).then((r) => r.data ?? []),
      ]);
      for (const design of designs as unknown as { job_id: string; zones: WorkZone[] | null }[]) {
        const zones = design.zones ?? [];
        let hours = 0;
        let known = zones.length > 0;
        for (const zone of zones) {
          const time = zoneCrewHours(zone, catalog);
          if (time.missingTiming) known = false;
          hours += time.hours;
        }
        hoursByJob.set(design.job_id, { hours, known: known && hours > 0 });
      }
    }
  } catch {
    caveats.push("The site plans could not be read, so every job is treated as a full day.");
  }

  // -------------------------------------------------------------- the jobs
  const scheduled = new Set((sessionRows as unknown as { job_id: string }[]).map((s) => s.job_id));

  const toJob = (row: {
    id: string;
    name: string;
    created_at: string;
    properties: { lat: number | null; lng: number | null; address: string | null } | null;
    job_requested_services?: { service_type_id: string }[];
    // One object rather than an array: job_proposals has a UNIQUE on job_id.
    job_proposals?: { client_chosen_day: string | null; status: string }[] | { client_chosen_day: string | null; status: string } | null;
  }): SchedulableJob => {
    const services = embedded(row.job_requested_services).map((s) => s.service_type_id);
    const accepted = embedded(row.job_proposals).find((p) => p.status === "accepted" || p.status === "approved");
    return {
      jobId: row.id,
      label: row.properties?.address || row.name,
      crewHours: hoursByJob.get(row.id)?.hours ?? 0,
      hoursKnown: hoursByJob.get(row.id)?.known ?? false,
      ready: standing?.ready.has(row.id) ?? false,
      blockingIssues: standing?.why.get(row.id)?.filter((r) => r.kind === "blocking-issue").length ?? 0,
      lat: row.properties?.lat ?? null,
      lng: row.properties?.lng ?? null,
      clientPreferredDate: accepted?.client_chosen_day ?? null,
      soldAt: row.created_at,
      weatherSensitive: services.some((s) => WEATHER_STOPS.some((w) => s.includes(w))),
    };
  };

  const rows = jobRows as unknown as Parameters<typeof toJob>[0][];
  const wanting = rows.filter((row) => !scheduled.has(row.id)).map(toJob);
  const already = (sessionRows as unknown as { job_id: string; starts_on: string; status: string }[])
    .filter((s) => s.status !== "cancelled")
    .map((s) => {
      const row = rows.find((r) => r.id === s.job_id);
      return row ? { job: toJob(row), date: s.starts_on } : null;
    })
    .filter((x): x is { job: SchedulableJob; date: string } => x != null);

  return {
    enabled: true,
    suggestions: suggestSchedule(wanting, days, today),
    moves: suggestMoves(already, days, today),
    caveats,
  };
}
