/**
 * Which parts of the county lot the crew works on, for a job with no drawn
 * site map. Kept on the proposal's options as crewMap, so it travels with the
 * scope. Without it the crew page lights up the whole lot.
 */
export type CrewMapArea = "front" | "back" | "sides" | "foundation";
export const CREW_MAP_AREAS: { key: CrewMapArea; label: string }[] = [
  { key: "front", label: "Front yard" },
  { key: "sides", label: "Sides of the house" },
  { key: "back", label: "Back yard" },
  { key: "foundation", label: "Beds along the house" },
];

export interface CrewMap {
  areas: CrewMapArea[];
  /** Quarter turns, when the county's "front" came out on the wrong side. */
  turn: number;
}

export function readCrewMap(options: unknown): CrewMap | null {
  const raw = (options as { crewMap?: { areas?: unknown; turn?: unknown } } | null)?.crewMap;
  if (!raw || !Array.isArray(raw.areas)) return null;
  const areas = raw.areas.filter((a): a is CrewMapArea => CREW_MAP_AREAS.some((x) => x.key === a));
  if (areas.length === 0) return null;
  const turn = Number.isInteger(raw.turn) ? (((raw.turn as number) % 4) + 4) % 4 : 0;
  return { areas, turn };
}
