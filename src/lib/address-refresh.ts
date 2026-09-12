/**
 * When a corrected address never reaches the map.
 *
 * An imported contact carries its address twice: `customers.import_address`,
 * which is what the file said, and a `properties` row, which is where the
 * geocoder decided that was and is what every map, route and out-of-area
 * check actually reads.
 *
 * Re-importing a corrected file updated the first and never the second. The
 * placing step skips any contact that already has a property — right, when
 * somebody added it by hand; wrong, when the property is the old bad address
 * the re-import was meant to fix. So a corrected address sat in a column
 * nothing reads, the property kept pointing at a house in the wrong county,
 * and the list of addresses to check kept asking for a fix that had already
 * been made.
 *
 * This works out which contacts are in that state and which of them can be
 * safely re-placed.
 */

import { normalizeAddress } from "@/lib/dedupe";

export interface AddressState {
  id: string;
  name: string;
  /** What the most recent import said. */
  importAddress: string | null;
  /** The addresses on this contact's properties. */
  propertyAddresses: string[];
}

export type RefreshVerdict =
  /** The property matches the file. Nothing to do. */
  | "matches"
  /** No property yet — the normal placing step covers this one. */
  | "unplaced"
  /** One property, and it says something else. Safe to re-place. */
  | "stale"
  /** Several properties. Which one the file meant is a guess. */
  | "ambiguous"
  /** Nothing imported for this contact, so there is nothing to compare to. */
  | "nothing_imported";

export function verdictFor(state: AddressState): RefreshVerdict {
  const imported = (state.importAddress ?? "").trim();
  if (!imported) return "nothing_imported";
  if (state.propertyAddresses.length === 0) return "unplaced";

  const wanted = normalizeAddress(imported);
  if (state.propertyAddresses.some((address) => normalizeAddress(address) === wanted)) {
    return "matches";
  }

  // More than one property and no match is a person with two houses and a
  // file naming a third. Replacing one of them is a coin toss, and quietly
  // moving the wrong house is worse than leaving a list to work through.
  return state.propertyAddresses.length === 1 ? "stale" : "ambiguous";
}

/** The ones that can be corrected without anybody choosing. */
export function staleOnes(states: AddressState[]): AddressState[] {
  return states.filter((state) => verdictFor(state) === "stale");
}

/** The ones a person has to look at, because we would be guessing. */
export function ambiguousOnes(states: AddressState[]): AddressState[] {
  return states.filter((state) => verdictFor(state) === "ambiguous");
}

/** The button's own label, so it says what it will actually do. */
export function refreshLabel(count: number): string {
  if (count === 0) return "Addresses are up to date";
  return count === 1 ? "Re-place 1 corrected address" : `Re-place ${count} corrected addresses`;
}

/** What to say afterwards. */
export function refreshSummary(input: {
  placed: number;
  failed: number;
  ambiguous: number;
}): string {
  const parts: string[] = [];
  parts.push(
    input.placed === 1 ? "Moved 1 address to where the file says" : `Moved ${input.placed} addresses to where the file says`
  );
  if (input.failed > 0) parts.push(`${input.failed} could not be looked up`);
  if (input.ambiguous > 0) {
    parts.push(
      `${input.ambiguous} ${input.ambiguous === 1 ? "contact has" : "contacts have"} more than one property, so nothing was moved for ${input.ambiguous === 1 ? "them" : "those"}`
    );
  }
  return `${parts.join(". ")}.`;
}
