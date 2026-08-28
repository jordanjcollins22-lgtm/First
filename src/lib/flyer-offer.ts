/**
 * The flyer, sold.
 *
 * The flyer already goes out and already costs what it costs. Seven of its
 * eight tiles are empty paper we are paying postage on, so this is the offer
 * that turns them into money: one tile, one run, one price.
 *
 * Every number a prospective advertiser is shown here is arithmetic on our
 * own figures. No industry response rates, no "direct mail converts at four
 * percent" — those get quoted at people constantly, none of them can be
 * checked, and one wrong claim on a page that takes card payments is worse
 * than a page with no claims at all. What a local business actually wants to
 * know is how many doors and how much each one costs, and both of those we
 * know exactly.
 */

import { AD_HEIGHT_IN, AD_PIXEL_HEIGHT, AD_PIXEL_WIDTH, AD_WIDTH_IN, SELLABLE_SLOT_COUNT } from "@/lib/flyer";

/** Homes one run lands in. */
export const FLYERS_PER_RUN = 2500;

/** What one tile on one run costs, in cents. */
export const SPOT_PRICE_CENTS = 30_000;

/** Tiles for sale. The eighth is ours and carries the postage indicia. */
export const SPOTS_PER_RUN = SELLABLE_SLOT_COUNT;

/** Print resolution artwork has to hit to not look soft on paper. */
export const REQUIRED_DPI = 300;

/** Below this a design is visibly blurry once printed. */
const MIN_ACCEPTABLE_SCALE = 0.75;

/** Files a phone or a designer will actually produce. */
export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "application/pdf"];

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * What each home costs the advertiser.
 *
 * The number the whole pitch rests on, and the one nobody can argue with
 * because it is just the price divided by the doors.
 */
export function costPerHomeCents(): number {
  return SPOT_PRICE_CENTS / FLYERS_PER_RUN;
}

export function costPerHome(): string {
  const cents = costPerHomeCents();
  // Under a dollar reads far better in cents than as "$0.12".
  return cents < 100 ? `${cents.toFixed(cents % 1 === 0 ? 0 : 1)}c` : money(cents);
}

export interface OfferStat {
  label: string;
  value: string;
  detail: string;
}

export function offerStats(): OfferStat[] {
  return [
    {
      label: "Homes reached",
      value: FLYERS_PER_RUN.toLocaleString(),
      detail: "Local homeowners, delivered to the door by the post office.",
    },
    {
      label: "Cost per home",
      value: costPerHome(),
      detail: "The whole price divided by the doors. Nothing else to add on.",
    },
    {
      label: "Spots on a run",
      value: String(SPOTS_PER_RUN),
      detail: "Once they are gone the run is printed and that is that.",
    },
  ];
}

/**
 * How many jobs it takes to pay for itself.
 *
 * Asked as a question rather than promised as a result. We have no idea what
 * their response rate will be and neither does anybody who tells them.
 */
export function breakEvenJobs(averageJobCents: number): number | null {
  if (!(averageJobCents > 0)) return null;
  return Math.ceil(SPOT_PRICE_CENTS / averageJobCents);
}

export function breakEvenLine(averageJobCents: number): string | null {
  const jobs = breakEvenJobs(averageJobCents);
  if (jobs == null) return null;
  return jobs === 1
    ? "One job pays for the whole run."
    : `${jobs} jobs pay for the whole run.`;
}

// ---------------------------------------------------------------------------
// The artwork
// ---------------------------------------------------------------------------

export interface ArtworkSpec {
  widthIn: number;
  heightIn: number;
  pixelWidth: number;
  pixelHeight: number;
  dpi: number;
}

export function artworkSpec(): ArtworkSpec {
  return {
    widthIn: AD_WIDTH_IN,
    heightIn: AD_HEIGHT_IN,
    pixelWidth: AD_PIXEL_WIDTH,
    pixelHeight: AD_PIXEL_HEIGHT,
    dpi: REQUIRED_DPI,
  };
}

/** The one line to put above the upload button. */
export function specLine(): string {
  const spec = artworkSpec();
  return `${spec.widthIn}" wide by ${spec.heightIn}" tall, ${spec.pixelWidth} by ${spec.pixelHeight} pixels at ${spec.dpi} DPI. PNG, JPG or PDF.`;
}

export type ArtworkVerdict = "ok" | "warn" | "reject";

export interface ArtworkCheck {
  verdict: ArtworkVerdict;
  message: string;
}

/**
 * Whether a design will survive being printed.
 *
 * Checked before they pay, not after. A blurry advert discovered at the
 * printer is a refund and an apology; the same advert caught here is a
 * two minute fix by whoever made it.
 */
export function checkArtwork(file: {
  type: string;
  bytes: number;
  /** Null for a PDF, whose page size a browser cannot read. */
  width: number | null;
  height: number | null;
}): ArtworkCheck {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return { verdict: "reject", message: "That file type will not print. Send a PNG, JPG or PDF." };
  }
  if (file.bytes > MAX_UPLOAD_BYTES) {
    return { verdict: "reject", message: "That file is over 25MB. Export it a little smaller." };
  }
  if (file.bytes === 0) {
    return { verdict: "reject", message: "That file is empty." };
  }

  // A PDF is print-ready by nature and its page size is not something the
  // browser can measure, so it is taken on trust and eyeballed in the preview.
  if (file.width == null || file.height == null) {
    return { verdict: "ok", message: "Looks good. Check the preview before you approve it." };
  }

  const spec = artworkSpec();

  // Both faults can be true at once, and both are worth saying. A design that
  // is the wrong shape AND too small told off for only one of them comes back
  // a second time still wrong.
  const problems: string[] = [];

  // Proportions first: the wrong shape gets cropped, and what gets cropped is
  // usually the phone number.
  const wanted = spec.pixelWidth / spec.pixelHeight;
  const actual = file.width / file.height;
  if (Math.abs(actual - wanted) / wanted > 0.08) {
    problems.push(
      `That is a different shape to the space, so the edges will be cropped. The space is ${spec.widthIn}" by ${spec.heightIn}".`
    );
  }

  if (
    file.width < spec.pixelWidth * MIN_ACCEPTABLE_SCALE ||
    file.height < spec.pixelHeight * MIN_ACCEPTABLE_SCALE
  ) {
    problems.push(
      `At ${file.width} by ${file.height} it will look soft in print. Ideally send ${spec.pixelWidth} by ${spec.pixelHeight}.`
    );
  }

  if (problems.length > 0) return { verdict: "warn", message: problems.join(" ") };

  return { verdict: "ok", message: "That will print nicely." };
}

// ---------------------------------------------------------------------------
// What is left
// ---------------------------------------------------------------------------

export function spotsLeft(taken: number): number {
  return Math.max(0, SPOTS_PER_RUN - Math.max(0, taken));
}

/**
 * Scarcity, but only the true kind.
 *
 * There really are seven, and when they are gone the run really is printed.
 * Saying "only 2 left!" when there are seven is the fastest way to make a
 * local business stop believing anything else on the page.
 */
export function spotsLabel(taken: number): string {
  const left = spotsLeft(taken);
  if (left === 0) return "This run is full. Ask us about the next one.";
  if (left === 1) return "One spot left on this run.";
  return `${left} of ${SPOTS_PER_RUN} spots left on this run.`;
}

export function isSoldOut(taken: number): boolean {
  return spotsLeft(taken) === 0;
}
