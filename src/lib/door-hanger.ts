/**
 * Two door hangers out of one sheet of paper.
 *
 * A letter sheet cut straight down the middle gives two 4.25" x 11" hangers,
 * which is the whole reason the size is what it is — no waste, no odd
 * offcut, and the printer only ever handles ordinary paper.
 *
 * The die line is not decoration. A hanger without the knob hole and the slot
 * running up to the top edge cannot go on a door, and it is exactly the thing
 * somebody forgets until five hundred are printed.
 */

/** Inches. Half a letter sheet, which is what makes two per page work. */
export const SHEET_WIDTH_IN = 8.5;
export const SHEET_HEIGHT_IN = 11;
export const HANGER_WIDTH_IN = SHEET_WIDTH_IN / 2;
export const HANGER_HEIGHT_IN = SHEET_HEIGHT_IN;

/** Big enough for a lever handle, not just a round knob. */
export const HOLE_DIAMETER_IN = 1.75;
export const HOLE_CENTRE_FROM_TOP_IN = 2.25;

/** The slot the door handle passes through on the way in. */
export const SLOT_WIDTH_IN = 0.5;
export const SLOT_TOP_FROM_TOP_IN = 0.5;

/** What an advertiser or designer should send. 300dpi of the printed size. */
export const ARTWORK_PIXEL_WIDTH = Math.round(HANGER_WIDTH_IN * 300);
export const ARTWORK_PIXEL_HEIGHT = Math.round(HANGER_HEIGHT_IN * 300);

export type HangerSide = "left" | "right";
export const SIDES: readonly HangerSide[] = ["left", "right"];

/**
 * The die line as fractions of one hanger.
 *
 * Fractions rather than inches so the same numbers drive the screen preview
 * and the printed sheet — the preview is scaled, the paper is not, and one of
 * those two being drawn from different numbers is how they drift apart.
 */
export interface DieLine {
  /** 0-1 across the hanger. */
  holeCentreX: number;
  /** 0-1 down the hanger. */
  holeCentreY: number;
  /** Diameter as a fraction of the hanger's width. */
  holeSize: number;
  slotWidth: number;
  /** 0-1 down the hanger, where the slot meets the top edge. */
  slotTop: number;
}

export function dieLine(): DieLine {
  return {
    holeCentreX: 0.5,
    holeCentreY: HOLE_CENTRE_FROM_TOP_IN / HANGER_HEIGHT_IN,
    holeSize: HOLE_DIAMETER_IN / HANGER_WIDTH_IN,
    slotWidth: SLOT_WIDTH_IN / HANGER_WIDTH_IN,
    slotTop: SLOT_TOP_FROM_TOP_IN / HANGER_HEIGHT_IN,
  };
}

/**
 * How far down the hanger is unusable.
 *
 * Anything above this is cut away or has a hole through it, so artwork with a
 * logo up there loses the logo. Told to whoever is designing it rather than
 * discovered by them.
 */
export function safeTopIn(): number {
  return HOLE_CENTRE_FROM_TOP_IN + HOLE_DIAMETER_IN / 2;
}

export interface HangerSlot {
  side: HangerSide;
  imagePath: string | null;
  label: string | null;
}

/** Whether there is anything to print on a side. */
export function isFilled(slot: HangerSlot | undefined): boolean {
  return Boolean(slot?.imagePath);
}

/** Sides still empty. */
export function emptySides(slots: HangerSlot[]): HangerSide[] {
  const bySide = new Map(slots.map((slot) => [slot.side, slot]));
  return SIDES.filter((side) => !isFilled(bySide.get(side)));
}

/**
 * What a sheet will actually produce.
 *
 * Two per sheet only if both sides have artwork — one side filled and one
 * empty is a sheet that yields one hanger and one piece of scrap, which is
 * worth saying out loud before five hundred go through the printer.
 */
export function hangersPerSheet(slots: HangerSlot[]): number {
  return SIDES.filter((side) => isFilled(slots.find((slot) => slot.side === side))).length;
}

/** How many sheets to run for a given number of hangers. */
export function sheetsNeeded(hangers: number, slots: HangerSlot[]): number | null {
  const perSheet = hangersPerSheet(slots);
  if (perSheet === 0 || hangers <= 0) return null;
  return Math.ceil(hangers / perSheet);
}
