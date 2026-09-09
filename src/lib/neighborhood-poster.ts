/**
 * The "we're working in your neighborhood" sign, as measurements.
 *
 * A frame sign that goes in a lawn or a window while a crew is on the street.
 * The neighbours see the truck anyway; this is what turns seeing the truck
 * into a phone call.
 *
 * Everything is a fraction of the poster rather than a number of inches, so
 * the same design comes out right in a twenty by thirty frame, a two foot by
 * three, or whatever somebody finds in a garage. The drawing code multiplies
 * by the real size once.
 *
 * No artwork here, and no fonts. Just where things go and how big, which is
 * the part that has to be right and the part worth checking.
 */

export interface PosterColours {
  /** The dark green of the discount box and the second line. */
  deep: string;
  /** The bright green of the outline, the arrow and the burst marks. */
  bright: string;
  ink: string;
  paper: string;
}

export const COLOURS: PosterColours = {
  deep: "#1B7A28",
  bright: "#58C322",
  ink: "#111111",
  paper: "#FFFFFF",
};

/** A band across the poster, measured as a fraction of its height. */
export interface Band {
  key: string;
  /** Top and bottom, 0 at the top of the poster and 1 at the bottom. */
  top: number;
  bottom: number;
}

/**
 * The bands, top to bottom.
 *
 * The gaps between them are deliberate and are what stops a sign looking like
 * a leaflet. The discount box is the biggest thing on it because it is the
 * only thing on it a stranger is deciding about.
 */
export const BANDS: Band[] = [
  { key: "logo", top: 0.03, bottom: 0.2 },
  { key: "working", top: 0.24, bottom: 0.33 },
  { key: "neighborhood", top: 0.35, bottom: 0.42 },
  { key: "offer", top: 0.45, bottom: 0.68 },
  { key: "scan", top: 0.72, bottom: 0.95 },
];

export function bandFor(key: string): Band {
  const band = BANDS.find((b) => b.key === key);
  if (!band) throw new Error(`No band called ${key}`);
  return band;
}

/** The side margin, as a fraction of the poster's width. */
export const SIDE_MARGIN = 0.045;

/** What each line of the sign says. */
export interface PosterWords {
  working: string;
  neighborhood: string;
  offerSmall: string;
  offerBig: string[];
  scanLead: string;
  scanLines: string[];
  fallbackTitle: string;
  fallbackLines: string[];
}

export const WORDS: PosterWords = {
  working: "WE'RE WORKING",
  neighborhood: "IN YOUR NEIGHBORHOOD",
  offerSmall: "GET A",
  offerBig: ["NEIGHBORHOOD", "DISCOUNT"],
  scanLead: "SCAN",
  scanLines: ["TO CLAIM", "YOUR DISCOUNT"],
  fallbackTitle: "Can't scan?",
  fallbackLines: ["Call or text", "the number", "on our truck."],
};

/**
 * The size of type that makes a line of text fill a width.
 *
 * A sign is read from a pavement, so every line wants to be as big as its box
 * allows and no bigger. Working it out from the font rather than picking a
 * number means the longest line still fits when somebody changes the wording,
 * which they will.
 */
export function fitToWidth(
  text: string,
  maxWidth: number,
  maxHeight: number,
  widthAt: (size: number) => number
): number {
  if (!text.trim()) return 0;
  // Widths scale linearly with size in every font a PDF ships with, so one
  // measurement is enough and a search would be slower and no more accurate.
  const atOne = widthAt(1);
  const byWidth = atOne > 0 ? maxWidth / atOne : maxHeight;
  // Cap heights include the ascender and a little air; 0.72 of the point size
  // is what a capital actually occupies in Helvetica.
  const byHeight = maxHeight / 0.72;
  return Math.min(byWidth, byHeight);
}

/** Where the three things along the bottom sit, across the poster's width. */
export interface ScanLayout {
  arrowRight: number;
  qrLeft: number;
  qrSize: number;
  fallbackLeft: number;
}

/**
 * The bottom row: the arrow and its words, the code, and what to do instead.
 *
 * The code is the point of the row and gets the middle and the most space. It
 * is also the one thing on the poster with a minimum size that is not about
 * taste: a code somebody photographs from ten feet away has to be big enough
 * to resolve, which on a poster this size means about a fifth of its width.
 */
export function scanLayout(posterWidth: number, bandHeight: number): ScanLayout {
  const qrSize = Math.min(bandHeight, posterWidth * 0.22);
  const qrLeft = (posterWidth - qrSize) / 2;
  return {
    arrowRight: qrLeft - posterWidth * 0.02,
    qrLeft,
    qrSize,
    fallbackLeft: qrLeft + qrSize + posterWidth * 0.02,
  };
}

/** Where a scan of this sign lands, and how we know it came from one. */
export function posterBookingPath(orgSlug: string | null | undefined): string {
  const slug = (orgSlug ?? "").trim();
  const params = new URLSearchParams({ src: "neighborhood-sign" });
  if (slug) params.set("org", slug);
  return `/book?${params.toString()}`;
}

/** One line inside the offer box: how tall it may be and where it sits. */
export interface OfferLine {
  /** The tallest a capital may be, in the same units as the box. */
  maxHeight: number;
  /** The baseline, measured down from the top of the box. */
  baseline: number;
}

/**
 * The lines inside the offer box, sized so they cannot collide.
 *
 * Each line is set as big as its width allows, and a short word set to a
 * width is a tall word: "DISCOUNT" came out half an inch taller than
 * "NEIGHBORHOOD" above it and printed through it. So the height each line may
 * take is worked out from the room between the baselines rather than from a
 * fraction somebody picked, and no line can be taller than its own row.
 */
export function offerLines(boxHeight: number, bigCount: number): { small: OfferLine; big: OfferLine[] } {
  const padding = boxHeight * 0.08;
  const inner = boxHeight - 2 * padding;
  // The small line is a fifth of the room; the big ones share the rest.
  const smallRow = inner * 0.2;
  const bigRow = bigCount > 0 ? (inner - smallRow) / bigCount : 0;
  // A little air inside each row, so two full-height capitals do not touch.
  const fit = 0.86;

  return {
    small: { maxHeight: smallRow * fit, baseline: padding + smallRow * 0.9 },
    big: Array.from({ length: bigCount }, (_, i) => ({
      maxHeight: bigRow * fit,
      baseline: padding + smallRow + bigRow * (i + 0.88),
    })),
  };
}
