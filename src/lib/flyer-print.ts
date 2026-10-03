/**
 * What printing a mailing's flyers takes: how much paper to set aside, and
 * the loads it goes through the printer in.
 *
 * One flyer is one sheet, printed on both sides, so the sheets to set aside
 * are the pieces in the mailing, no more and no fewer. A load is what one
 * tray holds: the printer cannot be told "print 522" and left alone when the
 * tray takes 50, so the run is cut into loads and each one is its own print,
 * started when the tray is full again.
 *
 * Pure, because it decides how much paper comes off the shelf.
 */

/** Sheets in one pack of the flyer paper on the inventory list. */
export const SHEETS_PER_PACK = 500;

/**
 * The trays on the Brother MFC-L8930CDW, from Brother's own spec sheet.
 *
 * The flyer paper is 80 lb gloss text, 120 g/m², which is about 32 lb bond.
 * Brother rates the 250-sheet tray for 16 to 28 lb bond and the bypass tray
 * for 16 to 43 lb, so the bypass tray is the one rated for this paper, and it
 * takes 50 sheets. The big tray stays an option for whoever finds it feeds
 * this paper anyway, but it is not the default.
 */
export const TRAYS = {
  bypass: { label: "Bypass tray (rated for this paper)", sheets: 50 },
  main: { label: "Main tray", sheets: 250 },
} as const;

export type TrayKey = keyof typeof TRAYS;

export interface PrintLoad {
  /** 1-based. */
  number: number;
  /** The first flyer in this load, counting from 1 across the whole run. */
  from: number;
  /** The last flyer in this load, inclusive. */
  to: number;
  sheets: number;
}

export interface PrintPlan {
  sheets: number;
  packs: number;
  /** Sheets left in the last pack once the run is out. */
  leftInLastPack: number;
  /** Flyers already through the printer. */
  printed: number;
  /** The loads still to print, from the first flyer not yet printed. */
  loads: PrintLoad[];
}

/**
 * The paper for the whole mailing, and the loads still to go.
 *
 * Progress is how many flyers are through, not which loads are ticked, so
 * swapping trays halfway (50 at a time, then 250) carries straight on from
 * the next flyer instead of reprinting or skipping any.
 */
export function printPlan(pieces: number, perLoad: number, printed = 0): PrintPlan {
  const sheets = Math.max(0, Math.floor(pieces));
  const size = Math.max(1, Math.floor(perLoad));
  const through = Math.min(sheets, Math.max(0, Math.floor(printed)));
  const packs = Math.ceil(sheets / SHEETS_PER_PACK);
  const loads: PrintLoad[] = [];
  for (let from = through + 1; from <= sheets; from += size) {
    const to = Math.min(sheets, from + size - 1);
    loads.push({ number: loads.length + 1, from, to, sheets: to - from + 1 });
  }
  return { sheets, packs, leftInLastPack: packs * SHEETS_PER_PACK - sheets, printed: through, loads };
}

/**
 * The flyers a PDF asks for, made safe: whole numbers, at least one, never
 * past the mailing, and never more than one tray's worth at a time.
 */
export function clampLoad(from: number, count: number, pieces: number, max: number = TRAYS.main.sheets): { from: number; count: number } {
  const total = Math.max(1, Math.floor(pieces));
  const start = Math.min(total, Math.max(1, Math.floor(from) || 1));
  const wanted = Math.max(1, Math.floor(count) || 1);
  return { from: start, count: Math.min(wanted, max, total - start + 1) };
}
