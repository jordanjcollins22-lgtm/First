import { createClient } from "@/lib/supabase/server";
import { buildLoadout, type Loadout, type LoadoutCheck, type LoadoutSession, type LoadoutTool } from "@/lib/loadout";
import { readDay, type CrewEvent, type CrewEventKind, type Stop } from "@/lib/crew-day";

export interface CrewToday {
  profileId: string;
  name: string;
  isLead: boolean;
  /** Where they are in the day, in the crew screen's own words. */
  headline: string;
  phase: string;
  stops: Stop[];
  loadout: Loadout;
}

export interface CrewsToday {
  day: string;
  /** Every stop booked today, whoever is on it. */
  stops: (Stop & { crewNames: string[] })[];
  crews: CrewToday[];
  /** Stops with nobody on them yet. */
  unstaffed: Stop[];
}

/**
 * Today from the office side: every job being done, who is on it, and
 * what each person has to load before they leave. The same list the crew
 * tick on their phones, with their ticks showing, so a wrong list is caught
 * before the truck moves rather than at the first stop.
 */
export async function getCrewsToday(day: string): Promise<CrewsToday> {
  const supabase = await createClient();

  const { data: sessionRows } = await supabase
    .from("job_work_sessions")
    .select(
      "id, job_id, starts_on, purpose, stop_order, kits, tool_ids, materials, jobs(id, status, properties(address, lat, lng, customers(name)))"
    )
    .lte("starts_on", day)
    .gte("ends_on", day)
    .not("status", "in", "(cancelled,done)");

  type Row = {
    id: string;
    job_id: string;
    starts_on: string;
    purpose: string | null;
    stop_order: number | null;
    kits: number[] | null;
    tool_ids: string[] | null;
    materials: string[] | null;
    jobs: {
      id: string;
      status: string;
      properties: { address: string; lat: number | null; lng: number | null; customers: { name: string } | null } | null;
    } | null;
  };

  const rows = ((sessionRows ?? []) as unknown as Row[])
    .filter((r) => r.jobs?.status !== "cancelled" && r.jobs?.status !== "completed")
    .sort((a, b) => {
      const ao = a.stop_order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.stop_order ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      if (a.starts_on !== b.starts_on) return a.starts_on < b.starts_on ? -1 : 1;
      return a.job_id < b.job_id ? -1 : 1;
    });

  const jobIds = [...new Set(rows.map((r) => r.job_id))];
  if (jobIds.length === 0) return { day, stops: [], crews: [], unstaffed: [] };

  const [{ data: crewRows }, { data: toolRows }, { data: containerRows }, { data: checkRows }, { data: eventRows }] =
    await Promise.all([
      supabase
        .from("job_crew")
        .select("job_id, profile_id, is_lead, profiles!job_crew_profile_id_fkey(full_name, email)")
        .in("job_id", jobIds),
      supabase.from("tools").select("id, name, kits").eq("active", true),
      supabase.from("kit_containers").select("name, kits").is("archived_at", null),
      supabase.from("loadout_checks").select("profile_id, item_kind, item_key").eq("day", day),
      supabase.from("crew_day_events").select("profile_id, kind, job_id, at").eq("day", day).order("at", { ascending: true }),
    ]);

  type CrewRow = {
    job_id: string;
    profile_id: string;
    is_lead: boolean;
    profiles: { full_name: string | null; email: string } | null;
  };
  const crew = (crewRows ?? []) as unknown as CrewRow[];

  const tools: LoadoutTool[] = ((toolRows ?? []) as { id: string; name: string; kits: number[] | null }[]).map((t) => ({
    id: t.id,
    name: t.name,
    kits: t.kits ?? [],
  }));
  const containers = ((containerRows ?? []) as { name: string; kits: number[] | null }[]).map((c) => ({
    name: c.name,
    kits: c.kits ?? [],
  }));

  const checksBy = new Map<string, LoadoutCheck[]>();
  for (const c of (checkRows ?? []) as { profile_id: string; item_kind: string; item_key: string }[]) {
    const list = checksBy.get(c.profile_id) ?? [];
    list.push({ kind: c.item_kind as LoadoutCheck["kind"], key: c.item_key });
    checksBy.set(c.profile_id, list);
  }
  const eventsBy = new Map<string, CrewEvent[]>();
  for (const e of (eventRows ?? []) as { profile_id: string; kind: string; job_id: string | null; at: string }[]) {
    const list = eventsBy.get(e.profile_id) ?? [];
    list.push({ kind: e.kind as CrewEventKind, jobId: e.job_id, at: e.at });
    eventsBy.set(e.profile_id, list);
  }

  const stopOf = (r: Row): Stop => ({
    jobId: r.job_id,
    sessionId: r.id,
    address: r.jobs?.properties?.address ?? "Address missing",
    customerName: r.jobs?.properties?.customers?.name ?? "Client",
    lat: r.jobs?.properties?.lat ?? null,
    lng: r.jobs?.properties?.lng ?? null,
    purpose: r.purpose,
  });
  const loadoutSessionOf = (r: Row): LoadoutSession => ({
    sessionId: r.id,
    jobId: r.job_id,
    customerName: r.jobs?.properties?.customers?.name ?? "Client",
    address: r.jobs?.properties?.address ?? "Address missing",
    kits: r.kits ?? [],
    toolIds: r.tool_ids ?? [],
    materials: r.materials ?? [],
  });

  const people = new Map<string, { name: string; isLead: boolean; jobs: Set<string> }>();
  for (const c of crew) {
    const p = people.get(c.profile_id) ?? {
      name: c.profiles?.full_name || c.profiles?.email || "Someone",
      isLead: false,
      jobs: new Set<string>(),
    };
    p.isLead = p.isLead || c.is_lead;
    p.jobs.add(c.job_id);
    people.set(c.profile_id, p);
  }

  const crews: CrewToday[] = [...people.entries()]
    .map(([profileId, p]) => {
      const mine = rows.filter((r) => p.jobs.has(r.job_id));
      const stops = mine.map(stopOf);
      const state = readDay(eventsBy.get(profileId) ?? [], stops);
      return {
        profileId,
        name: p.name,
        isLead: p.isLead,
        headline: state.headline,
        phase: state.phase,
        stops,
        loadout: buildLoadout(mine.map(loadoutSessionOf), tools, containers, checksBy.get(profileId) ?? []),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const namesByJob = new Map<string, string[]>();
  for (const c of crew) {
    const list = namesByJob.get(c.job_id) ?? [];
    list.push(c.profiles?.full_name || c.profiles?.email || "Someone");
    namesByJob.set(c.job_id, list);
  }
  const stops = rows.map((r) => ({ ...stopOf(r), crewNames: namesByJob.get(r.job_id) ?? [] }));

  return { day, stops, crews, unstaffed: stops.filter((s) => s.crewNames.length === 0) };
}
