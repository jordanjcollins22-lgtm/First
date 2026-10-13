import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { dateKeyIn } from "@/lib/time-zone";
import { embeddedOne } from "@/lib/postgrest";
import { addDays, blockReason, WORK_TYPE_LABEL, type DayWeather } from "@/lib/weather-cascade/rules";
import { forecastFor, loadWeatherOpsSettings, readCrewDays } from "@/lib/data/weather-cascade";
import type { WeatherOpsSettings } from "@/lib/weather-cascade/settings";

/**
 * Everything the weather panel shows, read as the signed-in owner.
 */

const untyped = (c: unknown) => c as SupabaseClient;

export interface RiskyDay {
  sessionId: string;
  date: string;
  label: string;
  workType: string;
  reason: string;
  /** False when the cascade will leave it alone (booked before the switch, or under way). */
  movable: boolean;
}

export interface ProposalGroup {
  key: string;
  ids: string[];
  reason: string;
  why: string | null;
  moves: { label: string; from: string; to: string; cause: string }[];
  createdAt: string;
}

export interface RecentMove {
  id: string;
  label: string;
  from: string;
  to: string;
  status: string;
  reason: string;
  clientsTold: boolean;
  at: string;
}

export interface WeatherPanelData {
  settings: WeatherOpsSettings;
  today: string;
  risky: RiskyDay[];
  forecastError: string | null;
  proposals: ProposalGroup[];
  recent: RecentMove[];
  movedLast30: number;
  toldLast30: number;
  openExceptions: number;
}

export async function getWeatherPanelData(organizationId: string): Promise<WeatherPanelData> {
  const sb = untyped(await createClient());
  const settings = await loadWeatherOpsSettings(sb, organizationId);
  const today = dateKeyIn(new Date());
  const empty: WeatherPanelData = {
    settings,
    today,
    risky: [],
    forecastError: null,
    proposals: [],
    recent: [],
    movedLast30: 0,
    toldLast30: 0,
    openExceptions: 0,
  };
  if (!settings.ready) return empty;

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [days, { data: proposed }, { data: recentRows }, { count: openExceptions }] = await Promise.all([
    readCrewDays(sb, organizationId, settings, today).catch(() => ({ sessions: [], cascade: [] })),
    sb
      .from("weather_reschedules")
      .select("id, chain_key, run_key, reason, cause, from_starts_on, to_starts_on, created_at, exception_id, jobs(name, properties(address)), job_exceptions(detail)")
      .eq("organization_id", organizationId)
      .eq("status", "proposed")
      .gte("from_starts_on", today)
      .order("from_starts_on", { ascending: true }),
    sb
      .from("weather_reschedules")
      .select("id, status, reason, from_starts_on, to_starts_on, clients_notified_at, applied_at, created_at, jobs(name, properties(address))")
      .eq("organization_id", organizationId)
      .in("status", ["applied", "failed", "dismissed"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(60),
    sb
      .from("job_exceptions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("kind", "weather_interruption")
      .in("state", ["reported", "acknowledged"]),
  ]);

  const labelOf = (row: { jobs?: unknown }) => {
    const job = embeddedOne(row.jobs as { name: string | null; properties: unknown } | null);
    const property = embeddedOne(job?.properties as { address: string | null } | null);
    return property?.address || job?.name || "A job";
  };

  // Risky days: the next four days judged exactly as the cascade judges them.
  let risky: RiskyDay[] = [];
  let forecastError: string | null = null;
  if (days.cascade.length > 0) {
    try {
      const weather = await forecastFor(days.cascade, today);
      const lastDay = addDays(today, 3);
      const byId = new Map(days.sessions.map((s) => [s.id, s]));
      risky = days.cascade
        .filter((s) => s.startsOn >= today && s.startsOn <= lastDay && s.locationKey)
        .map((s) => {
          const w = weather.get(s.locationKey!) ?? new Map<string, DayWeather>();
          const reason = blockReason(s.workType, s.startsOn, w, settings.rules);
          if (!reason) return null;
          const row = byId.get(s.id);
          const property = embeddedOne(row?.jobs?.properties ?? null);
          return {
            sessionId: s.id,
            date: s.startsOn,
            label: property?.address || row?.jobs?.name || "A job",
            workType: WORK_TYPE_LABEL[s.workType],
            reason,
            movable: s.movable,
          };
        })
        .filter((r): r is RiskyDay => r != null)
        .sort((a, b) => a.date.localeCompare(b.date));
    } catch (err) {
      forecastError = err instanceof Error ? err.message : "The forecast couldn't be reached.";
    }
  }

  const groups = new Map<string, ProposalGroup>();
  for (const row of (proposed ?? []) as Record<string, unknown>[]) {
    const key = String(row.exception_id ?? `${row.chain_key}:${row.run_key}`);
    const group = groups.get(key) ?? {
      key,
      ids: [],
      reason: String(row.reason),
      why: (embeddedOne(row.job_exceptions as { detail: string | null } | null)?.detail ?? "").split("\n").find((l) => l.startsWith("Not moved automatically")) ?? null,
      moves: [],
      createdAt: String(row.created_at),
    };
    group.ids.push(String(row.id));
    if (row.cause === "weather" && group.moves.every((m) => m.cause !== "weather")) group.reason = String(row.reason);
    group.moves.push({ label: labelOf(row), from: String(row.from_starts_on), to: String(row.to_starts_on), cause: String(row.cause) });
    groups.set(key, group);
  }

  const recent: RecentMove[] = ((recentRows ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    label: labelOf(row),
    from: String(row.from_starts_on),
    to: String(row.to_starts_on),
    status: String(row.status),
    reason: String(row.reason),
    clientsTold: Boolean(row.clients_notified_at),
    at: String(row.applied_at ?? row.created_at),
  }));
  const applied = recent.filter((r) => r.status === "applied");

  return {
    settings,
    today,
    risky,
    forecastError,
    proposals: [...groups.values()],
    recent: recent.slice(0, 20),
    movedLast30: applied.length,
    toldLast30: applied.filter((r) => r.clientsTold).length,
    openExceptions: openExceptions ?? 0,
  };
}
