/**
 * Which tools a zone needs, and what to load for a day's work.
 *
 * Zones store tools as names, because that is what the canvas has always
 * written. Service defaults come from a link table and are ids. Somewhere in
 * between those two facts a raw id reached the screen and showed up as a run
 * of random characters, so resolution accepts either and never prints a token
 * it could not place.
 */

import type { Tool } from "@/types/domain";

/** A tool as anything else needs it: a name to read and an id to key on. */
export interface ResolvedTool {
  id: string;
  name: string;
  isRental: boolean;
}

/**
 * Turns a stored token into a tool.
 *
 * Matches by id first, then by name, because a name is what is stored and an
 * id is what the service-default link table holds. Case-insensitive on the
 * name so a tool renamed to "Wheelbarrow" still matches a zone that recorded
 * "wheelbarrow".
 */
export function resolveTool(token: string, tools: Tool[]): ResolvedTool | null {
  const byId = tools.find((t) => t.id === token);
  if (byId) return { id: byId.id, name: byId.name, isRental: byId.is_rental };

  const lowered = token.trim().toLowerCase();
  const byName = tools.find((t) => t.name.trim().toLowerCase() === lowered);
  if (byName) return { id: byName.id, name: byName.name, isRental: byName.is_rental };

  return null;
}

/**
 * Resolves a zone's stored tokens, dropping any that no longer exist.
 *
 * A tool deleted from the inventory leaves its name behind on every zone that
 * used it. Showing the leftover token would be showing a tool nobody can load;
 * dropping it is the honest answer, and the zone can be edited to pick the
 * replacement.
 */
export function resolveTools(tokens: string[], tools: Tool[]): ResolvedTool[] {
  const seen = new Set<string>();
  const out: ResolvedTool[] = [];
  for (const token of tokens) {
    const tool = resolveTool(token, tools);
    if (!tool || seen.has(tool.id)) continue;
    seen.add(tool.id);
    out.push(tool);
  }
  return out;
}

export interface Kit {
  number: number;
  toolNames: string[];
}

/** Every kit in the inventory, with what is in it. Sorted, so the picker
 * reads the same way each time. */
export function kitsFrom(tools: Tool[]): Kit[] {
  const byKit = new Map<number, string[]>();
  for (const tool of tools) {
    for (const kit of tool.kits ?? []) {
      const list = byKit.get(kit) ?? [];
      list.push(tool.name);
      byKit.set(kit, list);
    }
  }
  return [...byKit.entries()]
    .map(([number, toolNames]) => ({ number, toolNames: [...toolNames].sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.number - b.number);
}

/** The tool names in a kit — what picking a kit actually adds. */
export function expandKit(kitNumber: number, tools: Tool[]): string[] {
  return tools.filter((t) => (t.kits ?? []).includes(kitNumber)).map((t) => t.name);
}

/** Adds names to a selection without duplicating what is already there. */
export function addTools(current: string[], adding: string[]): string[] {
  const seen = new Set(current.map((n) => n.trim().toLowerCase()));
  const out = [...current];
  for (const name of adding) {
    const key = name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Whether every one of these names is already picked — what makes a kit
 * button read as applied rather than merely available. */
export function hasAllTools(current: string[], names: string[]): boolean {
  if (names.length === 0) return false;
  const picked = new Set(current.map((n) => n.trim().toLowerCase()));
  return names.every((n) => picked.has(n.trim().toLowerCase()));
}

/**
 * Takes a group of tools back out of a selection.
 *
 * Removes exactly what the group holds, and nothing cleverer. An earlier
 * version tried to keep tools that another fully-applied group still wanted,
 * which meant tapping a kit off could visibly do nothing — the overlap was
 * invisible and the rule unguessable. If another kit still needs a tool, its
 * button stops showing as applied, which is the feedback that tells somebody
 * to tap it again.
 */
export function removeTools(current: string[], removing: string[]): string[] {
  const dropping = new Set(removing.map((n) => n.trim().toLowerCase()));
  return current.filter((name) => !dropping.has(name.trim().toLowerCase()));
}

export interface DayToolLine {
  name: string;
  isRental: boolean;
  /** Which stops need it, so a crew can see why it is on the list. */
  jobLabels: string[];
}

/**
 * Everything to load for a day, across every stop.
 *
 * Deduped by tool and annotated with the stops that need it — a crew member
 * looking at "Plate compactor" wants to know whether that is one job or three
 * before deciding whether to make two trips.
 *
 * Nothing calls this today — the load list was taken off the Today screen.
 * Kept whole, with its tests, because the per-zone picking it reads from is
 * still there, so putting the list back is a matter of wiring.
 */
export function dayToolList(
  stops: { label: string; toolTokens: string[] }[],
  tools: Tool[]
): DayToolLine[] {
  const byTool = new Map<string, DayToolLine>();

  for (const stop of stops) {
    for (const resolved of resolveTools(stop.toolTokens, tools)) {
      const line = byTool.get(resolved.id) ?? {
        name: resolved.name,
        isRental: resolved.isRental,
        jobLabels: [],
      };
      if (!line.jobLabels.includes(stop.label)) line.jobLabels.push(stop.label);
      byTool.set(resolved.id, line);
    }
  }

  // Rentals first: they have to be collected from somewhere else before the
  // day starts, so they are the ones worth seeing at the top.
  return [...byTool.values()].sort((a, b) => {
    if (a.isRental !== b.isRental) return a.isRental ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
