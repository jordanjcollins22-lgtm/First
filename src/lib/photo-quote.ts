/**
 * Quoting small jobs from photos.
 *
 * A visit costs an hour of somebody's day plus the drive, which is fine for a
 * patio and too much for a few yards of mulch. So the owner sets a line: a
 * client who books with a budget under it skips picking a time and goes
 * straight to the pre-evaluation form, where they tap the areas they want
 * work in on their lot, say what they want done in each, and add photos. The
 * office prices it from that, or decides it needs a visit after all.
 *
 * The rule is about the budget bracket they picked, and it is cautious: a
 * bracket counts as under the line only when the whole of it is. "Not sure
 * yet" is a visit, and so is a bracket the line falls in the middle of,
 * because the cost of guessing wrong the other way is a big job quoted off
 * three phone photos.
 *
 * Pure, so the routing is tested without a database.
 */

import { BUDGET_RANGES } from "@/lib/booking-budget-ranges";

/** The line when the owner has not set one, in dollars. */
export const DEFAULT_PHOTO_QUOTE_LINE = 1500;

export interface PhotoQuoteSettings {
  enabled: boolean;
  /** Dollars. */
  line: number;
}

export const DEFAULT_PHOTO_QUOTES: PhotoQuoteSettings = { enabled: false, line: DEFAULT_PHOTO_QUOTE_LINE };

/** The stored row's two columns, as the database names them. */
export function readPhotoQuoteSettings(row: { photo_quotes?: boolean | null; photo_quote_line?: number | string | null } | null | undefined): PhotoQuoteSettings {
  const line = Number(row?.photo_quote_line);
  return {
    enabled: row?.photo_quotes === true,
    line: row?.photo_quote_line != null && Number.isFinite(line) && line > 0 ? line : DEFAULT_PHOTO_QUOTE_LINE,
  };
}

/**
 * The most a budget bracket goes up to, in dollars. Null for "Not sure yet",
 * a blank, or anything that isn't one of ours. The open-ended top bracket
 * has no ceiling.
 */
export function bracketTop(range: string | null | undefined): number | null {
  const value = (range ?? "").trim();
  if (!value || !(BUDGET_RANGES as readonly string[]).includes(value)) return null;
  if (/\+\s*$/.test(value)) return Infinity;
  const amounts = [...value.matchAll(/\$([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
  return amounts.length > 0 ? Math.max(...amounts) : null;
}

export type BookingRoute = "photo_quote" | "visit";

/** Whether a booking with this budget is quoted from photos or gets a visit. */
export function routeForBudget(range: string | null | undefined, settings: PhotoQuoteSettings | null): BookingRoute {
  if (!settings?.enabled || !(settings.line > 0)) return "visit";
  const top = bracketTop(range);
  return top != null && top <= settings.line ? "photo_quote" : "visit";
}

/** "$1,500", for the settings and the office screens. */
export function sayLine(line: number): string {
  return `$${Math.round(line).toLocaleString("en-US")}`;
}

/** A dollar line as typed into the settings: "1500", "$1,500". NaN when it isn't one. */
export function readLine(input: string): number {
  const cleaned = (input ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return NaN;
  const n = Number(cleaned);
  return n > 0 && n <= 1_000_000 ? n : NaN;
}

/**
 * The suggestions for one area, out of what the model wrote: one per line,
 * bullets and numbering taken off, short, no repeats, at most four. Anything
 * that reads like a price or a promise is dropped: the office quotes, the
 * suggestions only say what might be worth doing.
 */
export function parseIdeas(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of (raw ?? "").split(/\r?\n/)) {
    const text = line
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
      .replace(/\*\*/g, "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[.;,]+$/, "");
    if (text.length < 4 || text.length > 120) continue;
    if (/\$\s?\d|\bprice\b|\bcost\b|\bguarantee/i.test(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === 4) break;
  }
  return out;
}

/** What the model is told, for suggestions from one area's photos. */
export function ideasSystemPrompt(): string {
  return [
    "You help a landscaping company in Harford County, Maryland quote small jobs from a homeowner's photos.",
    "You are shown photos of one area of their property and what they said they want done there.",
    "Suggest 2 to 4 other things in that same area that might be worth doing, which the homeowner can tick if interested.",
    "Only work this company does: beds, mulch, stone, planting, lawn repair, seed or sod, cleanups, trimming, shrub removal, drainage, patios, walkways, low walls, soft washing.",
    "Each suggestion is one plain line under 12 words, starting with a verb, e.g. \"Edge the beds and top up the mulch\".",
    "Nothing they already asked for. No prices, no promises, no numbering, nothing else.",
    "If the photos don't show a yard or outdoor ground, reply with nothing at all.",
  ].join("\n");
}

/** What they said about the area, for the model to read with its photos. */
export function ideasBrief(spot: { wants: string; services: string[] }, serviceLabels: Record<string, string>): string {
  const asked = spot.services.map((s) => serviceLabels[s] ?? s);
  return [
    `What they want done here: ${spot.wants.trim() || "(they didn't say)"}`,
    asked.length ? `Kinds of work they ticked: ${asked.join("; ")}` : "",
    "Your suggestions, one per line:",
  ]
    .filter(Boolean)
    .join("\n");
}

/** What the office does next with a sent photo quote. */
export type PhotoQuoteOutcome = "priced" | "visit";

/** The words on the client's link to book a visit, after all. */
export function visitLinkMessage(input: { clientName: string | null; link: string }): string {
  const first = (input.clientName ?? "").trim().split(/\s+/)[0];
  return [
    `${first ? `Hi ${first}, thanks` : "Thanks"} for the photos.`,
    "This one is worth us seeing in person before we price it, so we can get it right.",
    `Pick a time that suits you here: ${input.link}`,
  ].join(" ");
}
