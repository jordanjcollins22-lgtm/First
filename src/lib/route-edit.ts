/**
 * Editing a door-hanger round, as a set of edits rather than a new round.
 *
 * A round arrives with its doors already chosen. Editing it is always the same
 * two answers — which doors, and in what order — and both of them are things
 * about a place, so both of them are given on the map. This module is the part
 * of that with no map in it: which doors are on the round after the edits made
 * so far, and what a tap does to that.
 *
 * The edits are kept as two sets rather than as a new list of doors, because
 * the save sends what changed: doors added, doors taken out. A round of four
 * hundred doors with one taken off should send one door, and the person who
 * reads the audit later should see one door taken off, not four hundred
 * rewritten.
 */

import type { Point } from "@/lib/route-order";

/** A house in the round's zone, on the round or not. */
export interface EditableHouse {
  id: string;
  address: string;
  lat: number;
  lng: number;
  /** True when this door was on the round before any of this editing. */
  on: boolean;
}

/**
 * What a tap on the map does.
 *
 * "pick" is what it always did — on the round or off it. The other two are the
 * two ways of saying what order the round is walked in, which are the same
 * answer arrived at differently: tap the doors in order, or draw the line the
 * walk should follow and let the doors fall along it.
 */
export type PickerMode = "pick" | "order" | "line";

export const MODE_LABEL: Record<PickerMode, string> = {
  pick: "Pick doors",
  order: "Tap in order",
  line: "Draw the line",
};

export const MODE_HINT: Record<PickerMode, string> = {
  pick: "Tap a house on the map to put it on the round or take it off. Filled means it's on.",
  order: "Tap the doors on the map in the order you want them walked. Tap one again to take it back out.",
  line: "Click along the way you want the round walked. The doors are numbered as they fall along the line.",
};

/** The doors taken out and the doors put in, since the round was opened. */
export interface RoundEdits {
  remove: Set<string>;
  add: Set<string>;
}

/**
 * Whether a door is on the round as it now stands.
 *
 * Either it started there and has not been taken out, or it has been put on
 * since. Both sets are consulted because a door can be taken out and put back,
 * and the answer after that is the one it started with.
 */
export function isOnRound(house: { id: string; on: boolean }, edits: RoundEdits): boolean {
  if (edits.add.has(house.id)) return true;
  if (edits.remove.has(house.id)) return false;
  return house.on;
}

/** The ids on the round now, for drawing it. */
export function idsOnRound(houses: EditableHouse[], edits: RoundEdits): Set<string> {
  return new Set(houses.filter((h) => isOnRound(h, edits)).map((h) => h.id));
}

/**
 * A tap on a door: on the round if it was off, off it if it was on.
 *
 * Taking out a door that was only ever added forgets the addition rather than
 * recording a removal, so tapping twice leaves the round exactly as it was and
 * the save sends nothing about that door at all.
 */
export function toggleHouse(houses: EditableHouse[], edits: RoundEdits, houseId: string): RoundEdits {
  const house = houses.find((h) => h.id === houseId);
  if (!house) return edits;

  const remove = new Set(edits.remove);
  const add = new Set(edits.add);
  if (isOnRound(house, edits)) {
    add.delete(houseId);
    if (house.on) remove.add(houseId);
  } else {
    remove.delete(houseId);
    if (!house.on) add.add(houseId);
  }
  return { remove, add };
}

/**
 * A tap on a door while saying the walking order.
 *
 * Tapping one already in the order takes it back out, so a mis-tap costs one
 * tap rather than starting again.
 */
export function toggleOrder(order: string[], houseId: string): string[] {
  return order.includes(houseId) ? order.filter((x) => x !== houseId) : [...order, houseId];
}

/**
 * The whole edit, as the map needs it.
 *
 * The list owns this state and the map only draws it and reports taps, so the
 * handlers travel with the data. That keeps the round's doors, the save and
 * the undo in one place while the editing happens on the big map, which is the
 * only place the doors are big enough to tell apart.
 */
export interface RouteEdit {
  playId: string;
  houses: EditableHouse[];
  /** The doors on the round now, after the edits made so far. */
  on: Set<string>;
  mode: PickerMode;
  /** House ids in the order they will be walked, so far. Empty means unsaid. */
  order: string[];
  /** The line drawn to describe the walk. */
  line: Point[];
  onToggle: (houseId: string) => void;
  onOrder: (order: string[]) => void;
  onLine: (line: Point[]) => void;
}
