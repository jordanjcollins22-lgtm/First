/**
 * The sign as a set of cutouts, not as a poster in pieces.
 *
 * The first version cut a twenty by thirty poster into eight sheets that had
 * to be butted together and taped, which means eight seams running through the
 * words and one wandering cut ruining the lot. This is the other way round and
 * it is how a sign like this is actually made: every phrase is its own shape
 * on its own sheet, cut out, and laid on the backing where you want it.
 *
 * Nothing joins to anything. A gap between two cutouts is a word space, which
 * is a thing that is supposed to be there, so a piece landing an eighth of an
 * inch out looks hand-made rather than broken.
 *
 * The constraint that shapes all of this: no cutout may be bigger than a sheet
 * of paper. A line too wide for one becomes two cutouts side by side with the
 * word space between them, and if a single word is still too wide the type
 * comes down until it fits. Everything here is in inches.
 */

import { COLOURS } from "@/lib/neighborhood-poster";

/** What a sheet can actually carry, once the printer's margins are gone. */
export const SHEET = { width: 11, height: 8.5 } as const;
export const SHEET_MARGIN = 0.3;
export const MAX_PIECE_WIDTH = SHEET.width - 2 * SHEET_MARGIN;
export const MAX_PIECE_HEIGHT = SHEET.height - 2 * SHEET_MARGIN;

/** White paper left round a phrase so there is something to cut along. */
export const PADDING = 0.16;

/** Between two halves of a line that had to be cut apart. */
const WORD_GAP = 0.28;

/** A capital occupies about this much of the point size in Helvetica. */
const CAP = 0.72;

export interface Board {
  width: number;
  height: number;
}

export interface Piece {
  id: string;
  kind: "text" | "qr";
  /** What it says. Empty for the code. */
  text: string;
  /** Point size, in inches, so the drawing code multiplies by 72 once. */
  fontSize: number;
  /** Finished size after cutting, including the white edge. */
  width: number;
  height: number;
  /** Where its top left corner goes on the board. */
  x: number;
  y: number;
  /** The colour behind it, or null for white paper. */
  fill: string | null;
  colour: string;
  /** Italic, for the one phrase that is. */
  italic?: boolean;
}

/** How a caller measures type. Width of the text at a point size, in inches. */
export type Measure = (text: string, fontSize: number, italic?: boolean) => number;

export interface RowSpec {
  id: string;
  text: string;
  /** How tall the capitals should be, in inches, before anything is cut down. */
  capHeight: number;
  fill: string | null;
  colour: string;
  italic?: boolean;
}

/**
 * One line of the sign, as the cutouts it becomes, all at y = 0.
 *
 * The type is set to the height asked for, then the line is broken at spaces
 * until every part fits a sheet. Only if a single word is still too wide does
 * the height come down, because a sign whose words are different sizes for no
 * reason looks like a mistake and a sign with one slightly smaller word looks
 * deliberate.
 */
export function rowPieces(spec: RowSpec, board: Board, measure: Measure, sideMargin: number): Piece[] {
  const words = spec.text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || spec.capHeight <= 0) return [];

  const usable = board.width - 2 * sideMargin;
  const roomForText = MAX_PIECE_WIDTH - 2 * PADDING;

  let fontSize = spec.capHeight / CAP;
  // A single word that will not fit a sheet at this size is the only reason to
  // shrink. Checked before splitting, because splitting cannot help it.
  const widest = () => Math.max(...words.map((word) => measure(word, fontSize, spec.italic)));
  while (widest() > roomForText && fontSize > 0.02) fontSize *= 0.97;

  // And never wider, all together, than the board it is going on.
  const whole = measure(spec.text, fontSize, spec.italic);
  const spacesWide = (words.length - 1) * WORD_GAP + words.length * 2 * PADDING;
  if (whole + spacesWide > usable) fontSize *= usable / (whole + spacesWide);

  const spaceWidth = measure(" ", fontSize, spec.italic) || fontSize * 0.28;

  // Greedy: as many words on a cutout as will fit one sheet.
  const groups: string[][] = [];
  let current: string[] = [];
  for (const word of words) {
    const attempt = [...current, word];
    if (current.length > 0 && measure(attempt.join(" "), fontSize, spec.italic) > roomForText) {
      groups.push(current);
      current = [word];
      continue;
    }
    current = attempt;
  }
  if (current.length > 0) groups.push(current);

  const height = fontSize * CAP + 2 * PADDING;
  const widths = groups.map((g) => measure(g.join(" "), fontSize, spec.italic) + 2 * PADDING);
  // The gap between cutouts is at least a word space, so the words read at
  // roughly the spacing they were set at even though each carries its own edge.
  const gap = Math.max(WORD_GAP, spaceWidth);
  const rowWidth = widths.reduce((total, w) => total + w, 0) + gap * (groups.length - 1);

  let x = (board.width - rowWidth) / 2;
  return groups.map((group, i) => {
    const piece: Piece = {
      id: groups.length === 1 ? spec.id : `${spec.id}-${i + 1}`,
      kind: "text",
      text: group.join(" "),
      fontSize,
      width: widths[i],
      height,
      x,
      y: 0,
      fill: spec.fill,
      colour: spec.colour,
      italic: spec.italic,
    };
    x += widths[i] + gap;
    return piece;
  });
}

/** The margin down either side of the board, as a fraction of its width. */
const SIDE = 0.05;
/** Air above the first cutout and below the last, as a fraction of the height. */
const END_MARGIN = 0.03;
const MIN_GAP = 0.015;
const MAX_GAP = 0.055;

/**
 * How tall each line's capitals are, as a fraction of the board's height.
 *
 * Fractions rather than inches so the same sign comes out right in a twenty by
 * thirty frame, a two foot by three, or whatever is in the garage.
 *
 * The sizes are picked against what a sheet of paper can actually carry, not
 * against what would look best on a board of that size. A single word cannot
 * be wider than a sheet, and "NEIGHBORHOOD" fills one at about four fifths of
 * an inch of capital — so a design that asks for two inches gets four fifths,
 * silently, and the line meant to be the small one ends up the big one. Asking
 * for roughly what is available keeps the order of the lines real: WE'RE
 * WORKING is the biggest thing on the sign, then DISCOUNT, and GET A is the
 * lead-in it looks like.
 *
 * Past about a two foot by three board the words stop growing, because the
 * paper stops. That is a fact about the printer rather than a decision here.
 */
interface RowPlan {
  id: string;
  /** Null means "the business's own name". */
  text: string | null;
  cap: number;
  fill: string | null;
  colour: string;
  italic?: boolean;
}

const SIGN_ROWS: readonly RowPlan[] = [
  { id: "name", text: null, cap: 0.032, fill: null, colour: COLOURS.ink },
  { id: "working", text: "WE'RE WORKING", cap: 0.047, fill: null, colour: COLOURS.ink },
  { id: "neighborhood", text: "IN YOUR NEIGHBORHOOD", cap: 0.028, fill: null, colour: COLOURS.deep },
  { id: "get-a", text: "GET A", cap: 0.018, fill: COLOURS.deep, colour: COLOURS.paper },
  { id: "offer-1", text: "NEIGHBORHOOD", cap: 0.027, fill: COLOURS.deep, colour: COLOURS.paper },
  { id: "offer-2", text: "DISCOUNT", cap: 0.045, fill: COLOURS.deep, colour: COLOURS.paper },
  { id: "scan", text: "SCAN TO CLAIM YOUR DISCOUNT", cap: 0.022, fill: null, colour: COLOURS.ink },
  { id: "qr", text: "", cap: 0, fill: null, colour: COLOURS.ink },
  {
    id: "fallback",
    text: "Can't scan? Call or text the number on our truck.",
    cap: 0.013,
    fill: null,
    colour: COLOURS.ink,
    italic: true,
  },
];

/** The code's own cutout: a square, as a fraction of the board's width. */
const QR_SHARE = 0.36;

export interface PiecePlan {
  board: Board;
  pieces: Piece[];
}

/**
 * Every cutout the sign is made of, in the order they go on the board.
 *
 * Laid out in two passes because a row's finished height is not known until it
 * has been set: a word too wide for a sheet brings its own line down, and the
 * rows below it move up. So the rows are built first and positioned after.
 */
export function planPieces(board: Board, businessName: string, measure: Measure): PiecePlan {
  const sideMargin = board.width * SIDE;
  const endMargin = board.height * END_MARGIN;
  const qrSide = Math.min(board.width * QR_SHARE, MAX_PIECE_HEIGHT, MAX_PIECE_WIDTH);

  const build = (scale: number): Piece[][] =>
    SIGN_ROWS.map((row) => {
      if (row.id === "qr") {
        return [
          {
            id: "qr",
            kind: "qr" as const,
            text: "",
            fontSize: 0,
            width: qrSide,
            height: qrSide,
            x: (board.width - qrSide) / 2,
            y: 0,
            fill: null,
            colour: COLOURS.ink,
          },
        ];
      }
      const text = row.text ?? businessName.toUpperCase();
      return rowPieces(
        {
          id: row.id,
          text,
          capHeight: row.cap * board.height * scale,
          fill: row.fill,
          colour: row.colour,
          italic: row.italic,
        },
        board,
        measure,
        sideMargin
      );
    }).filter((row) => row.length > 0);

  // Bring the whole sign down together if it will not fit the board, rather
  // than dropping a line. A shorter frame gets a smaller sign, not a sign with
  // the offer missing.
  let scale = 1;
  let rows = build(scale);
  const stackHeight = (built: Piece[][]) =>
    built.reduce((total, row) => total + row[0].height, 0) +
    board.height * MIN_GAP * Math.max(0, built.length - 1) +
    2 * endMargin;
  while (stackHeight(rows) > board.height && scale > 0.2) {
    scale *= 0.96;
    rows = build(scale);
  }

  const heights = rows.reduce((total, row) => total + row[0].height, 0);
  const slack = board.height - 2 * endMargin - heights;
  const gap = Math.max(
    board.height * MIN_GAP,
    Math.min(board.height * MAX_GAP, rows.length > 1 ? slack / (rows.length - 1) : 0)
  );
  const stack = heights + gap * (rows.length - 1);
  let y = Math.max(endMargin, (board.height - stack) / 2);

  const pieces: Piece[] = [];
  for (const row of rows) {
    for (const piece of row) pieces.push({ ...piece, y });
    y += row[0].height + gap;
  }

  return { board, pieces };
}

/** Whether a cutout can actually be printed on one sheet. */
export function fitsASheet(piece: Piece): boolean {
  return piece.width <= MAX_PIECE_WIDTH + 1e-9 && piece.height <= MAX_PIECE_HEIGHT + 1e-9;
}

/** Whether two cutouts would land on top of each other. */
export function overlaps(a: Piece, b: Piece): boolean {
  const slack = 1e-9;
  return (
    a.x + a.width > b.x + slack &&
    b.x + b.width > a.x + slack &&
    a.y + a.height > b.y + slack &&
    b.y + b.height > a.y + slack
  );
}

/** The same measurement as a fraction, for somebody holding a tape measure. */
export function inchesAndSixteenths(value: number): string {
  const whole = Math.floor(value + 1e-9);
  const sixteenths = Math.round((value - whole) * 16);
  if (sixteenths === 0) return `${whole}in`;
  if (sixteenths === 16) return `${whole + 1}in`;
  const divisor = gcd(sixteenths, 16);
  return `${whole} ${sixteenths / divisor}/${16 / divisor}in`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
