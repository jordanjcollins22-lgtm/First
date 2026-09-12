/**
 * Door-hanger zones as the screens read them.
 *
 * A zone is a set of houses with an outline no other zone shares, a walk
 * through its doors in order, a place to park, and a mode: whether the
 * doors are close enough to walk, or a scooter or a vehicle is the honest
 * way to cover them. Pure helpers for what the map and the panel say.
 */

export type ZoneMode = "foot" | "scooter" | "vehicle";

export const MODE_LABEL: Record<ZoneMode, string> = {
  foot: "On foot",
  scooter: "Electric scooter",
  vehicle: "Vehicle",
};

export const MODE_COLOR: Record<ZoneMode, string> = {
  foot: "#16a34a",
  scooter: "#d97706",
  vehicle: "#dc2626",
};

export const MODE_WHY: Record<ZoneMode, string> = {
  foot: "under 55 m of street per door",
  scooter: "55 to 110 m of street per door",
  vehicle: "over 110 m of street per door",
};

export function modeOf(value: string | null | undefined): ZoneMode | null {
  return value === "foot" || value === "scooter" || value === "vehicle" ? value : null;
}

/** Zone properties as the map layer carries them. */
export interface ZoneProperties {
  id: string;
  name: string;
  zip: string | null;
  mode: string | null;
  houses: number;
  pathKm: number | null;
  minutes: number | null;
  gapM: number | null;
  park: { lat: number; lng: number } | null;
  start: { lat: number; lng: number } | null;
  startAddress: string | null;
  routeId: string | null;
  walkability: string | null;
  reason: string | null;
  waveId: string | null;
  clients: number;
  /** An evaluation, a client, or marketing still to do in it: the zones the office needs to see. */
  active?: boolean;
  /** Marketing plays still to do in it. */
  open?: number;
  /** Gaps in the round: places no road joins, driven rather than walked. */
  breaks?: number;
  /** How far those gaps are, together, in kilometres. */
  jumpKm?: number;
}

/**
 * The streets of a round: [lng, lat] along them, or a list of those when
 * no road joins two parts of a zone. Null when no street reaches it.
 */
export type WalkLine = [number, number][] | [number, number][][] | null;

/**
 * The walked streets as a list of runs. One run is the whole round; more
 * than one means the road network breaks and the walker drives between
 * them, so nothing is drawn across the gap.
 */
export function walkRunsOf(walkLine: WalkLine): [number, number][][] | null {
  if (!Array.isArray(walkLine) || walkLine.length === 0) return null;
  const nested = Array.isArray(walkLine[0]) && Array.isArray((walkLine[0] as unknown[])[0]);
  const runs = (nested ? (walkLine as [number, number][][]) : [walkLine as [number, number][]]).filter((run) => run.length > 1);
  return runs.length > 0 ? runs : null;
}

/** "3 h 40 min", "45 min". */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** How many people it takes to do the zone in one half-day, at four hours each. */
export function crewFor(minutes: number | null | undefined, hoursEach = 4): number {
  if (minutes == null || minutes <= 0) return 1;
  return Math.max(1, Math.ceil(minutes / 60 / hoursEach));
}

/** The order zones are worth doing in: clients first, then walkable, then the most doors per hour. */
export function rankZones<T extends Pick<ZoneProperties, "clients" | "mode" | "houses" | "minutes">>(zones: T[]): T[] {
  const modeRank = (m: string | null) => (m === "foot" ? 0 : m === "scooter" ? 1 : 2);
  const rate = (z: T) => (z.minutes ? z.houses / z.minutes : 0);
  return [...zones].sort((a, b) => b.clients - a.clients || modeRank(a.mode) - modeRank(b.mode) || rate(b) - rate(a));
}
