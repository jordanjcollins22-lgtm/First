/**
 * A spot's size, in words, for the client's estimate page and the office.
 *
 * The client sees one plain line under each spot: how big we think it is and
 * where that came from, so they can tell at a glance whether we've got it
 * right ("About 640 sq ft, traced on the map"). When the size is only a
 * stand-in, we don't dress it up as a measurement: it says we'll measure it
 * at the visit. The office sees the same size with the source and how sure
 * it is, so the evaluator knows which sizes to check.
 *
 * Pure and free of server imports, so the client page can use it.
 */

import type { SizeConfidence, SizeSource, SpotSizing } from "@/lib/spot-sizing";

/**
 * How one spot was sized, as kept with the estimate: the shared SpotSizing,
 * plus what the satellite picture and photos were read as, for the office.
 * The note is the model's one line about what it saw; it is kept even when
 * a better source (a traced outline) set the price, so the evaluator can
 * see whether the two agree. Never shown to the client.
 */
export interface EstimateSizing extends SpotSizing {
  aiNote: string | null;
  /** How sure the picture reading was, when there was one. */
  aiConfidence: SizeConfidence | null;
}

const SOURCES: SizeSource[] = ["traced", "ai", "history", "typical"];
const CONFIDENCES: SizeConfidence[] = ["high", "medium", "low"];
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * The sizing column, read back. Estimates from before it was kept have none,
 * so this is [] for them, and anything malformed is skipped rather than
 * trusted: the page says nothing about a spot's size sooner than say
 * something wrong.
 */
export function readSizing(value: unknown): EstimateSizing[] {
  if (!Array.isArray(value)) return [];
  const out: EstimateSizing[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    const index = num(r.index);
    if (index == null || !SOURCES.includes(r.source as SizeSource) || !CONFIDENCES.includes(r.confidence as SizeConfidence)) continue;
    out.push({
      index,
      choices: Array.isArray(r.choices) ? r.choices.filter((c): c is string => typeof c === "string") : [],
      areaSqft: num(r.areaSqft),
      count: num(r.count),
      source: r.source as SizeSource,
      confidence: r.confidence as SizeConfidence,
      from: typeof r.from === "string" ? r.from : "",
      priceCents: num(r.priceCents),
      aiNote: typeof r.aiNote === "string" && r.aiNote.trim() ? r.aiNote : null,
      aiConfidence: CONFIDENCES.includes(r.aiConfidence as SizeConfidence) ? (r.aiConfidence as SizeConfidence) : null,
    });
  }
  return out;
}

/** What a spot's count means, by the counted choice it was asked for (remove first, then trim, then plants, as spot-price reads it). */
const COUNT_WORDS: [choice: string, one: string, many: string][] = [
  ["remove", "bush to take out", "bushes to take out"],
  ["trim", "bush to trim", "bushes to trim"],
  ["plants", "new plant", "new plants"],
];

/** Ground choices: when one of these is on a spot, its area is that ground; otherwise a wash spot's area is the siding. */
const GROUND = ["mulch", "rock", "weeds", "lawn", "water"];

/**
 * A size rounded the way a person would say it: to 5 under 100, to 10 under
 * 1,000, to 50 above. "About 637 sq ft" claims a precision nobody has.
 */
export function roundSqft(n: number): number {
  const step = n < 100 ? 5 : n < 1000 ? 10 : 50;
  return Math.max(step, Math.round(n / step) * step);
}

/** "About 640 sq ft and 6 bushes to trim", or null when the spot has no size to give. */
export function sizeAmount(s: Pick<SpotSizing, "areaSqft" | "count" | "choices">): string | null {
  const parts: string[] = [];
  if (s.areaSqft != null && s.areaSqft > 0) {
    const siding = s.choices.includes("wash") && !s.choices.some((c) => GROUND.includes(c));
    parts.push(`${roundSqft(s.areaSqft).toLocaleString("en-US")} sq ft${siding ? " of siding" : ""}`);
  }
  if (s.count != null && s.count > 0) {
    const words = COUNT_WORDS.find(([c]) => s.choices.includes(c));
    if (words) parts.push(`${s.count} ${s.count === 1 ? words[1] : words[2]}`);
  }
  return parts.length ? `About ${parts.join(" and ")}` : null;
}

/** Whether a size is firm enough to put in front of the client as ours. */
export function sizeIsFirm(s: Pick<SpotSizing, "source" | "confidence">): boolean {
  return s.source !== "typical" && s.confidence !== "low";
}

export const AT_VISIT = "We'll measure this at your visit";

/**
 * The client's line for one spot. `hasPhotos` keeps "and your photos" honest
 * when they sent none. Null when the spot has nothing to size (only things
 * priced on the visit), since the scope already says so.
 */
export function clientSizeWords(s: SpotSizing, opts: { hasPhotos: boolean; traced?: boolean }): string | null {
  const amount = sizeAmount(s);
  if (s.priceCents == null && !amount) return null;
  if (!amount) return AT_VISIT;
  if (!sizeIsFirm(s)) {
    // The record carries the spot's weakest size. When they drew round it,
    // the area is still theirs, measured; only the rest (a count of bushes,
    // say) waits for the visit, and the line should say which is which.
    const area = opts.traced ? sizeAmount({ ...s, count: null }) : null;
    return area ? `${area}, traced on the map. We'll count the rest at your visit` : AT_VISIT;
  }
  switch (s.source) {
    case "traced":
      return `${amount}, traced on the map`;
    case "ai":
      return `${amount}, from the satellite picture${opts.hasPhotos ? " and your photos" : ""}`;
    case "history":
      return `${amount}, typical for a spot like this on yards we've measured. We'll confirm it at your visit`;
    default:
      return AT_VISIT;
  }
}

const SOURCE_LABEL: Record<SizeSource, string> = {
  traced: "Traced by client",
  ai: "AI from satellite + photos",
  history: "Our measured jobs (median)",
  typical: "Typical lot share",
};

const CONFIDENCE_LABEL: Record<SizeConfidence, string> = { high: "high", medium: "medium", low: "low" };

/** For the office: "Traced by client · high confidence". */
export function officeSourceWords(s: Pick<SpotSizing, "source" | "confidence">): string {
  return `${SOURCE_LABEL[s.source]} · ${CONFIDENCE_LABEL[s.confidence]} confidence`;
}

/** Whether the evaluator should check this spot's size at the visit before quoting from it. */
export function needsChecking(s: Pick<SpotSizing, "source" | "confidence">): boolean {
  return s.source === "typical" || s.source === "history" || s.confidence === "low";
}
