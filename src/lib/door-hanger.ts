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

/**
 * The slit the handle passes through on the way in.
 *
 * One cut, not a slot: no paper is removed, the hanger just opens along the
 * line and closes behind the handle. It runs sideways out of the hole to the
 * edge of the hanger, so the hanger goes onto the handle from the side rather
 * than being posted down over it.
 */
export const SLIT_SIDE: "left" | "right" = "left";

/** What an advertiser or designer should send. 300dpi of the printed size. */
export const ARTWORK_PIXEL_WIDTH = Math.round(HANGER_WIDTH_IN * 300);
export const ARTWORK_PIXEL_HEIGHT = Math.round(HANGER_HEIGHT_IN * 300);

export type HangerSide = "left" | "right";
export const SIDES: readonly HangerSide[] = ["left", "right"];

/** Front of the sheet and back of the sheet. */
export type HangerFace = "front" | "back";
export const FACES: readonly HangerFace[] = ["front", "back"];

/**
 * Which half of the back sheet a hanger's back lands on.
 *
 * A duplex printer flips the paper left to right, so the back of the
 * left-hand hanger comes out on the right-hand half. Printing the back in
 * reading order would put each hanger's back on the other hanger — a mistake
 * that only shows up after the guillotine.
 */
export function backHalfFor(side: HangerSide): HangerSide {
  return side === "left" ? "right" : "left";
}

/** The halves of the back sheet, in the order they print. */
export function backSheetOrder(): HangerSide[] {
  return SIDES.map(backHalfFor);
}

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
  /** 0-1 down the hanger: the height the cut runs at. Level with the hole,
   * because a cut that meets it anywhere else does not open into it. */
  slitY: number;
  /** 0-1 across: the edge of the hanger the cut comes out of. */
  slitStart: number;
  /** 0-1 across: where the cut meets the hole. */
  slitEnd: number;
}

/**
 * The cut, as fractions of one hanger.
 *
 * Fractions rather than inches so the same numbers drive the screen preview
 * and the printed sheet — the preview is scaled, the paper is not, and one of
 * those two being drawn from different numbers is how they drift apart.
 *
 * Mirrored for the back of the sheet: a duplex printer flips the paper, so a
 * back drawn the same way round as the front would cut on the wrong side.
 */
export function dieLine(face: HangerFace = "front"): DieLine {
  const holeSize = HOLE_DIAMETER_IN / HANGER_WIDTH_IN;
  const holeCentreY = HOLE_CENTRE_FROM_TOP_IN / HANGER_HEIGHT_IN;

  // Out of the hole to whichever edge the slit runs to.
  const onLeft = face === "front" ? SLIT_SIDE === "left" : SLIT_SIDE !== "left";

  return {
    holeCentreX: 0.5,
    holeCentreY,
    holeSize,
    slitY: holeCentreY,
    slitStart: onLeft ? 0 : 1,
    // Stops where the circle starts, so the cut and the hole meet rather
    // than one being drawn across the other.
    slitEnd: onLeft ? 0.5 - holeSize / 2 : 0.5 + holeSize / 2,
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
  face: HangerFace;
  imagePath: string | null;
  label: string | null;
}

/** Whether there is anything to print on a side. */
export function isFilled(slot: HangerSlot | undefined): boolean {
  return Boolean(slot?.imagePath);
}

/** Sides of one face still empty. */
export function emptySides(slots: HangerSlot[], face: HangerFace = "front"): HangerSide[] {
  const onFace = slots.filter((slot) => slot.face === face);
  const bySide = new Map(onFace.map((slot) => [slot.side, slot]));
  return SIDES.filter((side) => !isFilled(bySide.get(side)));
}

/** The artwork for one half of one face, if there is any. */
export function slotAt(
  slots: HangerSlot[],
  side: HangerSide,
  face: HangerFace
): HangerSlot | undefined {
  return slots.find((slot) => slot.side === side && slot.face === face);
}

/**
 * What a sheet will actually produce.
 *
 * Two per sheet only if both sides have artwork — one side filled and one
 * empty is a sheet that yields one hanger and one piece of scrap, which is
 * worth saying out loud before five hundred go through the printer.
 */
export function hangersPerSheet(slots: HangerSlot[]): number {
  // Counted off the front. A back with no front is not a hanger, and a front
  // with no back is a perfectly good one-sided hanger.
  return SIDES.filter((side) => isFilled(slotAt(slots, side, "front"))).length;
}

/** Whether anything is on the back at all, which decides if it prints. */
export function hasBack(slots: HangerSlot[]): boolean {
  return SIDES.some((side) => isFilled(slotAt(slots, side, "back")));
}

/** How many sheets to run for a given number of hangers. */
export function sheetsNeeded(hangers: number, slots: HangerSlot[]): number | null {
  const perSheet = hangersPerSheet(slots);
  if (perSheet === 0 || hangers <= 0) return null;
  return Math.ceil(hangers / perSheet);
}
