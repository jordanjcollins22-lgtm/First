/**
 * Maryland's lawn fertilizer blackout.
 *
 * Under the Maryland Lawn Fertilizer Law no nitrogen or phosphorus goes on a
 * lawn from November 16 to March 1. A certified professional may still put
 * down up to 0.5 lb of nitrogen per 1,000 sq ft until December 1. Potassium
 * and lime are allowed all winter. (MDA fertilizer page; the 2025–26 notice.)
 *
 * Two jobs here, both pure so they are tested without a database:
 * recognising a fertilizer service from the words a line is written in, and
 * saying whether a given day is allowed. The words are all there is: services
 * are free text an evaluator picks or types ("Fertilization", "Weed & feed",
 * "Winterizer"), and the proposal snapshot keeps the label and scope text.
 *
 * "Until December 1" is read as through November 30. It is the conservative
 * reading, and the cost of being a day early is a phone call, not a fine.
 */

/** The rate a certified applicator may not exceed between Nov 16 and Dec 1. */
export const LATE_FALL_MAX_N_LB_PER_1000 = 0.5;

export type FertilizerWindow = "open" | "certified_only" | "blackout";

/** Month and day as numbers, from a YYYY-MM-DD string, without time zones getting a say. */
function monthDay(isoDate: string): { m: number; d: number } {
  const [, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return { m, d };
}

/** Which part of the year a calendar day falls in. */
export function fertilizerWindowOn(isoDate: string): FertilizerWindow {
  const { m, d } = monthDay(isoDate);
  if (m === 11 && d >= 16) return "certified_only";
  if (m === 12 || m === 1 || m === 2) return "blackout";
  return "open";
}

/**
 * Whether a line of work is a fertilizer application.
 *
 * Deliberately narrow. "Weed control" is a pesticide, not a fertilizer, and
 * is not in the blackout. Lime and potash are allowed all winter. Winterizing
 * the irrigation is not a winterizer.
 */
export function isFertilizerService(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    /fertili[sz]/.test(t) ||
    /weed\s*(?:and|&|n|'n'|-n-)\s*feed/.test(t) ||
    /\bwinterizer\b/.test(t) ||
    /\b(?:lawn|turf)\s+(?:feed|feeding)\b/.test(t) ||
    /\bnitrogen\b/.test(t) ||
    /\burea\b/.test(t)
  );
}

/** "0.5 lb N", "0.75 lbs of N per 1000", "1 lb nitrogen": the nitrogen rate written on a line, if any. */
export function nitrogenRateIn(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(/(\d+(?:\.\d+)?)\s*lbs?\.?\s*(?:of\s+)?(?:n\b|nitrogen)/i);
  return match ? Number(match[1]) : null;
}

export interface FertilizerCheck {
  ok: boolean;
  window: FertilizerWindow;
  /** The sentence to show: why it is blocked, or the condition it is allowed on. */
  message: string | null;
}

/**
 * Whether fertilizer may go down on this day.
 *
 * `certifiedOnFile` is whether the business has a current MDA fertilizer
 * applicator certification on its compliance calendar. `nitrogenLbPer1000`
 * is the rate written on the line, when one is.
 */
export function checkFertilizerDay(
  isoDate: string,
  opts: { certifiedOnFile: boolean; nitrogenLbPer1000?: number | null }
): FertilizerCheck {
  const window = fertilizerWindowOn(isoDate);
  if (window === "open") return { ok: true, window, message: null };
  if (window === "blackout") {
    return {
      ok: false,
      window,
      message:
        "Maryland's fertilizer blackout runs Nov 16 to Mar 1: no nitrogen or phosphorus on lawns. Book it on or after March 1, or swap it for lime or potassium.",
    };
  }
  if (!opts.certifiedOnFile) {
    return {
      ok: false,
      window,
      message:
        "From Nov 16 only a certified applicator may fertilize (up to 0.5 lb N per 1,000 sq ft, until Dec 1). Add a current fertilizer certification to the compliance calendar, or book it for March.",
    };
  }
  const rate = opts.nitrogenLbPer1000 ?? null;
  if (rate != null && rate > LATE_FALL_MAX_N_LB_PER_1000) {
    return {
      ok: false,
      window,
      message: `${rate} lb N per 1,000 sq ft is over the 0.5 lb limit for Nov 16 to Dec 1. Lower the rate or book it for March.`,
    };
  }
  return {
    ok: true,
    window,
    message: "Allowed for a certified applicator until Dec 1, at no more than 0.5 lb N per 1,000 sq ft.",
  };
}

/** Every calendar day from start to end, inclusive, as YYYY-MM-DD. */
export function daysBetween(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startIso.slice(0, 10)}T12:00:00Z`);
  const end = new Date(`${(endIso || startIso).slice(0, 10)}T12:00:00Z`);
  // A visit is days, not months: a bad range must not spin.
  for (let d = start, i = 0; d <= end && i < 400; d = new Date(d.getTime() + 86_400_000), i++) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * The verdict for a visit on a job: the first day in the range that is not
 * allowed for any fertilizer line on it, or ok.
 *
 * Lines that are not fertilizer are ignored, so a mow-and-lime visit in
 * January goes ahead.
 */
export function checkFertilizerVisit(input: {
  startsOn: string;
  endsOn: string;
  lines: string[];
  certifiedOnFile: boolean;
}): FertilizerCheck & { day: string | null; line: string | null } {
  const fert = input.lines.filter(isFertilizerService);
  if (fert.length === 0) return { ok: true, window: "open", message: null, day: null, line: null };
  let caution: (FertilizerCheck & { day: string | null; line: string | null }) | null = null;
  for (const day of daysBetween(input.startsOn, input.endsOn)) {
    for (const line of fert) {
      const verdict = checkFertilizerDay(day, { certifiedOnFile: input.certifiedOnFile, nitrogenLbPer1000: nitrogenRateIn(line) });
      if (!verdict.ok) return { ...verdict, day, line };
      if (verdict.message && !caution) caution = { ...verdict, day, line };
    }
  }
  return caution ?? { ok: true, window: "open", message: null, day: null, line: null };
}
