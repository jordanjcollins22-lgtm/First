/**
 * The address A/B test on the booking page.
 *
 * Half of visitors can tap "Use my location" and accept or decline the
 * address it finds; half type it. The variant is chosen once per browser
 * and kept, so the same person is not shown a button one day and not the
 * next. The answer is bookings over visits, per variant, and how sure we
 * can be that the difference is not luck.
 */

export type AddressVariant = "tap" | "type";
export type AddressEntry = "typed" | "located";
export type LocateResult = "accepted" | "declined" | "failed";

export const VARIANT_STORAGE_KEY = "book-address-variant";

export function pickVariant(random: () => number = Math.random): AddressVariant {
  return random() < 0.5 ? "tap" : "type";
}

export function isVariant(value: unknown): value is AddressVariant {
  return value === "tap" || value === "type";
}

/** The variant this browser was dealt, dealing one if it never has been. */
export function assignedVariant(storage: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null, random: () => number = Math.random): AddressVariant {
  try {
    const kept = storage?.getItem(VARIANT_STORAGE_KEY);
    if (isVariant(kept)) return kept;
    const dealt = pickVariant(random);
    storage?.setItem(VARIANT_STORAGE_KEY, dealt);
    return dealt;
  } catch {
    return pickVariant(random);
  }
}

export interface VisitRow {
  variant: AddressVariant;
  agent: string;
  locatedTapped: boolean;
  locatedResult: LocateResult | null;
  booked: boolean;
}

export interface VariantStats {
  variant: AddressVariant;
  visits: number;
  bookings: number;
  /** Bookings per visit, null with no visits. */
  rate: number | null;
  /** Tap variant only: how the button did. */
  tapped: number;
  accepted: number;
  declined: number;
  failed: number;
}

export interface TestSummary {
  tap: VariantStats;
  type: VariantStats;
  /** Positive when tapping books more. Null until both sides have visits. */
  lift: number | null;
  /** How sure we are the difference is real: a two-proportion z test. */
  confidence: number | null;
  verdict: string;
}

function stats(variant: AddressVariant, rows: VisitRow[]): VariantStats {
  const mine = rows.filter((r) => r.variant === variant);
  const bookings = mine.filter((r) => r.booked).length;
  return {
    variant,
    visits: mine.length,
    bookings,
    rate: mine.length > 0 ? bookings / mine.length : null,
    tapped: mine.filter((r) => r.locatedTapped).length,
    accepted: mine.filter((r) => r.locatedResult === "accepted").length,
    declined: mine.filter((r) => r.locatedResult === "declined").length,
    failed: mine.filter((r) => r.locatedResult === "failed").length,
  };
}

/** Standard normal CDF, close enough for a verdict. */
function phi(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** Only people count. A crawler that opens the page and never books drags a variant down for nothing. */
export function summariseTest(rows: readonly VisitRow[]): TestSummary {
  const people = rows.filter((r) => r.agent === "browser");
  const tap = stats("tap", people);
  const type = stats("type", people);

  let lift: number | null = null;
  let confidence: number | null = null;
  if (tap.visits > 0 && type.visits > 0 && tap.rate != null && type.rate != null) {
    lift = tap.rate - type.rate;
    const pooled = (tap.bookings + type.bookings) / (tap.visits + type.visits);
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / tap.visits + 1 / type.visits));
    confidence = se > 0 ? 1 - 2 * (1 - phi(Math.abs(lift) / se)) : null;
  }

  let verdict: string;
  const smallest = Math.min(tap.visits, type.visits);
  if (smallest < 30) verdict = `Too early to call. Fewest visits on a side: ${smallest}. Thirty each is the least worth reading.`;
  else if (confidence != null && confidence >= 0.95) verdict = lift! > 0 ? "Tapping books more. You can trust this." : "Typing books more. You can trust this.";
  else if (confidence != null && confidence >= 0.8) verdict = lift! > 0 ? "Tapping looks better, but it could still be luck." : "Typing looks better, but it could still be luck.";
  else verdict = "No real difference yet.";

  return { tap, type, lift, confidence, verdict };
}
