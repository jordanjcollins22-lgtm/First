/**
 * A poster bigger than the printer, cut into sheets that tape back together.
 *
 * A twenty by thirty inch sign is not something an office printer can make,
 * and a print shop is a day and a drive. It is something an office printer can
 * make in eight pieces, if the pieces are worked out properly: each sheet
 * carrying an exact rectangle of the poster, marks showing where to cut, and
 * enough artwork past the cut that a wobbly hand still lands on ink.
 *
 * Everything here is in inches, because that is what the frame is measured in
 * and what the person holding the scissors is thinking in. The drawing code
 * converts once, at the edge.
 */

export interface Inches {
  width: number;
  height: number;
}

/** US Letter, the only paper an office printer is certain to have. */
export const LETTER: Inches = { width: 8.5, height: 11 };

/**
 * How much artwork is printed past the cut line.
 *
 * Cut a hair inside the line and you get a white sliver at the seam, which is
 * the one thing that makes a taped poster look taped. An eighth of an inch of
 * extra artwork on every inside edge means a cut that wanders still lands on
 * ink.
 */
export const BLEED = 0.125;

/** How close to the paper's edge a printer can be trusted to put ink. */
export const SHEET_MARGIN = 0.3;

export interface Tile {
  /** Counting from one, so the labels printed on the sheets read as they should. */
  row: number;
  column: number;
  /** The rectangle of the poster this sheet carries, in inches from its top left. */
  source: { x: number; y: number; width: number; height: number };
  /** How much bleed this tile has on each side. Zero at the poster's own edges. */
  bleed: { top: number; right: number; bottom: number; left: number };
}

export interface TilePlan {
  /** Which way up the sheets are printed. */
  orientation: "portrait" | "landscape";
  sheet: Inches;
  poster: Inches;
  columns: number;
  rows: number;
  /** The exact rectangle of poster on each sheet, before bleed. */
  tile: Inches;
  tiles: Tile[];
  /** Where the trimmed artwork sits on the sheet, in inches from its top left. */
  offset: { x: number; y: number };
}

/**
 * The sheets one poster needs, laid out the way that needs fewest of them.
 *
 * Both ways up are tried. A twenty by thirty poster is nine sheets portrait
 * and eight landscape, and the eight also has one vertical seam instead of
 * two, which is the seam a person notices because it runs through the middle
 * of the words.
 */
export function planTiles(poster: Inches, sheet: Inches = LETTER, margin = SHEET_MARGIN): TilePlan {
  const ways = (["portrait", "landscape"] as const).map((orientation) => {
    const paper =
      orientation === "portrait"
        ? { width: sheet.width, height: sheet.height }
        : { width: sheet.height, height: sheet.width };
    const usable = { width: paper.width - 2 * margin, height: paper.height - 2 * margin };
    // The bleed eats into what a sheet can carry, on the inside edges only,
    // and every tile is the same size, so budget for it everywhere.
    const carries = { width: usable.width - 2 * BLEED, height: usable.height - 2 * BLEED };
    if (carries.width <= 0 || carries.height <= 0) return null;

    const columns = Math.max(1, Math.ceil(round(poster.width / carries.width)));
    const rows = Math.max(1, Math.ceil(round(poster.height / carries.height)));
    return { orientation, paper, usable, columns, rows, sheets: columns * rows, seams: columns - 1 + rows - 1 };
  });

  const best = ways
    .filter((way): way is NonNullable<typeof way> => way !== null)
    .sort((a, b) => a.sheets - b.sheets || a.seams - b.seams)[0];

  const tile = { width: poster.width / best.columns, height: poster.height / best.rows };
  const tiles: Tile[] = [];
  for (let row = 0; row < best.rows; row += 1) {
    for (let column = 0; column < best.columns; column += 1) {
      tiles.push({
        row: row + 1,
        column: column + 1,
        source: { x: column * tile.width, y: row * tile.height, width: tile.width, height: tile.height },
        // No bleed at the poster's own edges: there is nothing out there to
        // print, and a mark past the edge is a mark somebody cuts to.
        bleed: {
          top: row === 0 ? 0 : BLEED,
          bottom: row === best.rows - 1 ? 0 : BLEED,
          left: column === 0 ? 0 : BLEED,
          right: column === best.columns - 1 ? 0 : BLEED,
        },
      });
    }
  }

  return {
    orientation: best.orientation,
    sheet: best.paper,
    poster,
    columns: best.columns,
    rows: best.rows,
    tile,
    tiles,
    // Centred, so the trim marks are the same distance in on every sheet and
    // a stack of them lines up when you hold it to the light.
    offset: {
      x: (best.paper.width - tile.width) / 2,
      y: (best.paper.height - tile.height) / 2,
    },
  };
}

/** Which sheet this is, for the label printed in its margin. */
export function tileLabel(tile: Tile, plan: TilePlan): string {
  const of = plan.rows > 1 || plan.columns > 1 ? ` of ${plan.rows} by ${plan.columns}` : "";
  return `Row ${tile.row}, column ${tile.column}${of}`;
}

/** The order somebody should tape them up in, read out loud. */
export function assemblyOrder(plan: TilePlan): string {
  if (plan.tiles.length === 1) return "One sheet. Cut on the marks and it is done.";
  return (
    `${plan.tiles.length} sheets, ${plan.rows} down by ${plan.columns} across. ` +
    "Cut every sheet on its corner marks, then lay them out face down, top left first, " +
    "butt the cut edges together and tape the backs."
  );
}

/** Floating point makes 30 / 7.65 come out as 3.9215686274509807 or worse. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
