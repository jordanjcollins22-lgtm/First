/**
 * Taking things off a proposal that is already with the client.
 *
 * A client rings up and says the back bed is out of budget this year. What
 * used to happen: somebody regenerated the whole proposal from the site map,
 * which meant editing the site map to lie about what is there, and the record
 * of what was dropped lived in one person's memory.
 *
 * So a proposal can be trimmed directly. Two kinds of thing come off:
 *
 *  - a whole area, which takes its price with it, and
 *  - a written line inside an area, which is wording rather than money and
 *    leaves the price alone.
 *
 * The link does not change and neither does the token. The client refreshes
 * and sees the shorter proposal at the same address, which is the whole point.
 * What came off is recorded on our side rather than inferred from the
 * difference between two snapshots nobody kept.
 */

import type { ProposalZoneSnapshot } from "@/types/domain";

/**
 * The written lines of an area's scope, as separate removable things.
 *
 * Blank-line paragraphs and single newlines both count, and so does a
 * paragraph written as sentences, because that is how most of these are
 * typed. A one-sentence scope comes back as one line, which is correct: it
 * is removable as a whole or not at all.
 */
export function scopeLines(scopeText: string): string[] {
  const text = (scopeText ?? "").trim();
  if (!text) return [];

  const byNewline = text
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*[-•*]\s*/, "").trim())
    .filter(Boolean);
  if (byNewline.length > 1) return byNewline;

  // One paragraph. Split on sentence ends, keeping the punctuation, so a
  // removed sentence does not leave a stray full stop behind.
  const bySentence = text
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter(Boolean);
  return bySentence.length > 0 ? bySentence : [text];
}

/** Back to something a client reads, once some lines have gone. */
export function joinScopeLines(lines: string[]): string {
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

export interface TrimInput {
  zones: ProposalZoneSnapshot[];
  /** Area names coming off entirely. */
  removeZones: string[];
  /** Written lines coming off, by the area they sit in. */
  removeLines: { zoneName: string; line: string }[];
  /** What the proposal currently says the total is, in cents. */
  statedTotalCents: number;
}

export interface TrimResult {
  /** The snapshot to write back. */
  zones: ProposalZoneSnapshot[];
  /** Areas actually removed — names that matched something. */
  removedZones: { zoneName: string; serviceLabel: string; priceCents: number | null }[];
  removedLines: { zoneName: string; line: string }[];
  /** What we would charge now, in cents. */
  newTotalCents: number;
  /** How much came off the price. */
  removedCents: number;
  /**
   * Whether that total is arithmetic anybody can check.
   *
   * False when a removed area had no price snapshotted, or had one somebody
   * typed rather than the rate card produced. The number is still offered —
   * the office is doing this, not the client — but it is offered as a figure
   * to look at rather than one to trust.
   */
  totalExact: boolean;
  /** Why the total needs a second look, when it does. */
  totalNote: string | null;
  /** Nothing was actually taken off. */
  empty: boolean;
}

export function trimProposal(input: TrimInput): TrimResult {
  const dropZone = new Set(input.removeZones);
  const droppedLinesByZone = new Map<string, Set<string>>();
  for (const entry of input.removeLines) {
    const set = droppedLinesByZone.get(entry.zoneName) ?? new Set<string>();
    set.add(entry.line);
    droppedLinesByZone.set(entry.zoneName, set);
  }

  const removedZones: TrimResult["removedZones"] = [];
  const removedLines: TrimResult["removedLines"] = [];
  const kept: ProposalZoneSnapshot[] = [];

  for (const zone of input.zones) {
    if (dropZone.has(zone.zoneName)) {
      removedZones.push({
        zoneName: zone.zoneName,
        serviceLabel: zone.serviceLabel,
        priceCents: zone.priceCents ?? null,
      });
      continue;
    }

    const dropping = droppedLinesByZone.get(zone.zoneName);
    if (!dropping || dropping.size === 0) {
      kept.push(zone);
      continue;
    }

    const lines = scopeLines(zone.scopeText);
    const survivors = lines.filter((line) => {
      if (!dropping.has(line)) return true;
      removedLines.push({ zoneName: zone.zoneName, line });
      return false;
    });
    kept.push({ ...zone, scopeText: joinScopeLines(survivors) });
  }

  const removedCents = removedZones.reduce((sum, z) => sum + (z.priceCents ?? 0), 0);
  const unpriced = removedZones.some((z) => z.priceCents == null);
  const handEntered = input.zones.some(
    (z) => dropZone.has(z.zoneName) && z.priceCents != null && z.priceDerived === false
  );

  const totalNote = unpriced
    ? "One of the areas you removed had no price on it, so nothing came off the total. Set the price yourself."
    : handEntered
      ? "One of the areas you removed was priced by hand. Check the new total before you save it."
      : null;

  return {
    zones: kept,
    removedZones,
    removedLines,
    // Never below nothing, however the arithmetic lands.
    newTotalCents: Math.max(0, input.statedTotalCents - removedCents),
    removedCents,
    totalExact: !unpriced && !handEntered,
    totalNote,
    empty: removedZones.length === 0 && removedLines.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Who asked, and a change with nothing removed
// ---------------------------------------------------------------------------

/**
 * How the client asked for this.
 *
 * Most changes arrive as a text message rather than through the buttons on
 * the proposal, and a record that says only "the office changed it" reads,
 * months later, like we took work off a quote nobody asked us to change.
 */
export type RequestSource = "text" | "call" | "in_person" | "office";

export const REQUEST_SOURCES: { value: RequestSource; label: string }[] = [
  { value: "text", label: "They texted" },
  { value: "call", label: "They called" },
  { value: "in_person", label: "In person" },
  { value: "office", label: "Our call" },
];

export function sourceLabel(source: string | null | undefined): string | null {
  return REQUEST_SOURCES.find((s) => s.value === source)?.label ?? null;
}

/**
 * Whether there is anything to save.
 *
 * Removing something is the usual case, but not the only one. A client who
 * texts "can you add the stone edging, what would that be" ends with a price
 * that moved and nothing taken off, and that has to be recordable too — the
 * alternative is somebody editing the price with no note of why, which is the
 * thing this whole record exists to prevent.
 */
export function hasChange(input: {
  removedZones: unknown[];
  removedLines: unknown[];
  statedTotalCents: number;
  newTotalCents: number;
  note?: string;
}): boolean {
  if (input.removedZones.length > 0 || input.removedLines.length > 0) return true;
  if (input.newTotalCents !== input.statedTotalCents) return true;
  return Boolean(input.note?.trim());
}

/** What to call the button, so it never says "remove" for a price rise. */
export function saveLabel(input: {
  removedZones: unknown[];
  removedLines: unknown[];
  statedTotalCents: number;
  newTotalCents: number;
}): string {
  const removing = input.removedZones.length > 0 || input.removedLines.length > 0;
  if (removing) return "Update proposal";
  if (input.newTotalCents !== input.statedTotalCents) return "Update the price";
  return "Save the note";
}

/** Dollars, for the box the office types the new price into. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** What one saved trim reads as in the history. */
export function trimSummary(entry: {
  removedZones: { zoneName: string; serviceLabel: string }[];
  removedLines: { zoneName: string }[];
}): string {
  const parts: string[] = [];
  for (const zone of entry.removedZones) {
    parts.push(`${zone.zoneName} (${zone.serviceLabel})`);
  }
  if (entry.removedLines.length > 0) {
    const zones = new Set(entry.removedLines.map((l) => l.zoneName));
    const lineCount = entry.removedLines.length;
    parts.push(
      `${lineCount} written ${lineCount === 1 ? "line" : "lines"} from ${
        zones.size === 1 ? [...zones][0] : `${zones.size} areas`
      }`
    );
  }
  return parts.length > 0 ? `Removed ${parts.join(", ")}` : "Nothing removed";
}

/** The one line a saved change reads as, source and all. */
export function editHeadline(entry: {
  removedZones: { zoneName: string; serviceLabel: string }[];
  removedLines: { zoneName: string }[];
  requestedVia?: string | null;
  previousTotalCents?: number | null;
  newTotalCents?: number | null;
}): string {
  const removing = entry.removedZones.length > 0 || entry.removedLines.length > 0;
  const what = removing
    ? trimSummary(entry)
    : entry.previousTotalCents !== entry.newTotalCents
      ? "Price changed"
      : "Note added";
  const via = sourceLabel(entry.requestedVia);
  return via ? `${what} — ${via.toLowerCase()}` : what;
}

/** A signed dollar figure for the history row. */
export function priceMoveLabel(previousCents: number, newCents: number): string {
  const diff = newCents - previousCents;
  if (diff === 0) return "price unchanged";
  const money = (Math.abs(diff) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  return diff < 0 ? `−${money}` : `+${money}`;
}
