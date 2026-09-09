/**
 * The weed sheet's measurements, in points, for a PDF we make ourselves.
 *
 * The HTML sheet is printed by whatever browser is holding it, and browsers
 * disagree about the one thing that matters here: where the page ends. Two
 * rounds of this went out with the top of the back pages cut off, on a phone,
 * because a phone's browser used the printer's page box rather than the one
 * the page asked for. There is no CSS answer to that -- there is only not
 * asking a browser.
 *
 * So the sheet is also a PDF. A PDF says where every mark goes in absolute
 * points from the corner of the paper, and a printer does what it is told.
 * This module is the arithmetic: how wide a cell is, how tall a row is, and
 * which rows land on which page. It draws nothing, so it can be checked
 * without a printer.
 *
 * Everything here is in PostScript points, 72 to the inch, because that is
 * what a PDF counts in.
 */

/** US Letter, portrait. */
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;

/**
 * The margin.
 *
 * Half an inch of the paper's edge is where printers stop being able to put
 * ink -- a bypass tray on glossy stock is the worst of them -- so nothing goes
 * within 32 points of it. This is a real margin on every page, not padding
 * that the first page gets and the rest do not: each page here is drawn from
 * its own corner.
 */
export const MARGIN_TOP = 34;
export const MARGIN_BOTTOM = 34;
export const MARGIN_SIDE = 29;

/** Between cells, across and down. */
export const GAP = 8;

/** A photograph is four across by three down, as it is on the screen sheet. */
export const PHOTO_RATIO = 3 / 4;

export type SheetView = "client" | "crew";

export interface Geometry {
  columns: number;
  contentWidth: number;
  contentHeight: number;
  /** The width of one cell, including its border. */
  cellWidth: number;
  /** The width inside a cell's border and padding. */
  innerWidth: number;
  photoHeight: number;
  /** The side of the scannable square. */
  qrSize: number;
  /** How many lines of the common name a cell has room for. */
  nameLines: number;
  cellHeight: number;
  rowHeight: number;
}

/** Inside a cell, between its border and its contents. */
export const CELL_PADDING = 4;
/** Between a cell's photograph, its name and its code. */
export const CELL_GUTTER = 3;

const NAME_SIZE = 8;
const NAME_LEADING = 9.5;
const SMALL_SIZE = 6.5;
const SMALL_LEADING = 8;

export const FONT_SIZES = {
  name: NAME_SIZE,
  small: SMALL_SIZE,
  code: 6.5,
  heading: 8.5,
  title: 11,
  footer: 7,
  ctaTitle: 10,
  ctaBody: 8,
} as const;

export const LEADING = {
  name: NAME_LEADING,
  small: SMALL_LEADING,
  ctaBody: 9.5,
} as const;

/**
 * Everything the sheet's shape depends on, worked out from the view.
 *
 * The client's sheet is four across and shows a picture and a name, because a
 * homeowner points at a weed. The crew's is five across and carries the
 * scientific name and the prep note under it.
 */
export function geometryFor(view: SheetView): Geometry {
  const columns = view === "client" ? 4 : 5;
  const contentWidth = PAGE_WIDTH - 2 * MARGIN_SIDE;
  const contentHeight = PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;
  const cellWidth = (contentWidth - GAP * (columns - 1)) / columns;
  const innerWidth = cellWidth - 2 * CELL_PADDING;
  const photoHeight = innerWidth * PHOTO_RATIO;
  // Big enough that one module of a 29-module code lands on about six dots of
  // a 300dpi printer, which is where a phone camera stops struggling.
  const qrSize = view === "client" ? 54 : 48;
  // Two lines of name is the most any of them needs; most need one, and a row
  // is only as tall as what is actually in it.
  const nameLines = 2;

  const geometry: Geometry = {
    columns,
    contentWidth,
    contentHeight,
    cellWidth,
    innerWidth,
    photoHeight,
    qrSize,
    nameLines,
    cellHeight: 0,
    rowHeight: 0,
  };
  geometry.cellHeight = cellHeight(geometry, view, nameLines, true);
  geometry.rowHeight = geometry.cellHeight + GAP;
  return geometry;
}

/**
 * How tall a cell is, given what is going in it.
 *
 * Reserving room for the tallest thing a cell could hold costs about an inch a
 * row, and an inch a row costs two sheets of paper across the crew's sixty
 * three weeds. So a row is measured: the most name lines any cell in it needs,
 * and whether any of them has a prep note. Every cell in a row is then that
 * height, so the row still reads as a row.
 */
export function cellHeight(
  geometry: Pick<Geometry, "photoHeight" | "qrSize">,
  view: SheetView,
  nameLines: number,
  hasPrep: boolean
): number {
  const extra = view === "crew" ? 1 + (hasPrep ? 1 : 0) : 0;
  return (
    CELL_PADDING +
    geometry.photoHeight +
    CELL_GUTTER +
    Math.max(1, nameLines) * NAME_LEADING +
    extra * SMALL_LEADING +
    CELL_GUTTER +
    geometry.qrSize +
    CELL_PADDING
  );
}

/** The left edge of a column, from the left edge of the paper. */
export function columnX(geometry: Geometry, column: number): number {
  return MARGIN_SIDE + column * (geometry.cellWidth + GAP);
}

/** One thing that goes on a page and cannot be cut in half. */
export type Block<T> =
  | { kind: "title"; height: number }
  | { kind: "heading"; text: string; height: number }
  | { kind: "row"; weeds: T[]; height: number }
  | { kind: "cta"; height: number };

/** A block, and where its top edge sits, measured down from the paper's top. */
export interface Placed<T> {
  block: Block<T>;
  top: number;
}

/**
 * The blocks dealt out onto pages.
 *
 * A block never straddles a break, which is the whole point of building the
 * pages by hand. A heading never ends a page either: a heading alone at the
 * foot of a sheet sends somebody to the wrong list, so it travels with the
 * first row under it.
 */
export function paginate<T>(blocks: Block<T>[], contentHeight: number): Placed<T>[][] {
  const pages: Placed<T>[][] = [];
  let page: Placed<T>[] = [];
  let used = 0;

  const flush = () => {
    if (page.length > 0) pages.push(page);
    page = [];
    used = 0;
  };

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    let needed = block.height;
    // A heading is only worth putting down if what it names comes with it.
    if (block.kind === "heading" && blocks[i + 1]) needed += blocks[i + 1].height;

    if (used > 0 && used + needed > contentHeight) flush();

    page.push({ block, top: MARGIN_TOP + used });
    used += block.height;
  }
  flush();
  return pages;
}

/**
 * Text broken into lines that fit, and no more lines than there is room for.
 *
 * The width of a string is a property of the font, so the caller measures and
 * this decides. The last line it keeps is truncated with an ellipsis when
 * there was more to say, because a name cut off mid-word looks like a bug and
 * a name cut off with an ellipsis looks like a name that was too long.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  maxLines: number,
  measure: (line: string) => number
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || maxLines < 1) return [];

  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);

  // Anything that did not fit is admitted to rather than silently dropped: a
  // name that stops mid-word looks like a bug, and a name that ends in an
  // ellipsis looks like a name that was too long for the box.
  const fitted = lines.slice(0, maxLines).map((l) => truncate(l, maxWidth, measure));
  const saidEverything = words.join(" ") === fitted.join(" ");
  if (!saidEverything && fitted.length > 0) {
    const last = fitted[fitted.length - 1];
    if (!last.endsWith("…")) fitted[fitted.length - 1] = ellipsize(last, maxWidth, measure);
  }
  return fitted;
}

/** One line cut to fit, ending in an ellipsis. Left alone if it already fits. */
export function truncate(text: string, maxWidth: number, measure: (line: string) => number): string {
  return measure(text) <= maxWidth ? text : ellipsize(text, maxWidth, measure);
}

/** One line with an ellipsis on the end, shortened until the pair of them fit. */
function ellipsize(text: string, maxWidth: number, measure: (line: string) => number): string {
  let cut = text;
  while (cut.length > 0 && measure(`${cut}…`) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * Text a PDF's built-in fonts can actually set.
 *
 * The standard fourteen fonts are Latin-1, and a weed name or a business name
 * typed with a curly apostrophe would otherwise fail the whole download rather
 * than one character. The characters people really type are mapped to their
 * plain equivalents; anything left over is dropped, because a missing glyph is
 * better than a missing file.
 */
const SUBSTITUTES: Record<string, string> = {
  "\u2018": "'", "\u2019": "'", "\u201a": "'", "\u201c": '"', "\u201d": '"',
  "\u2013": "-", "\u2014": "\u2014", "\u2026": "\u2026", "\u00a0": " ", "\u2022": "\u00b7",
  "\u2032": "'", "\u2033": '"', "\u2212": "-",
};

export function latin1(text: string): string {
  let out = "";
  for (const character of text) {
    const swap = SUBSTITUTES[character];
    const candidate = swap ?? character;
    // A tab or a newline would be drawn as a box; a cell is one line anyway.
    if (candidate === "\n" || candidate === "\t" || candidate === "\r") {
      out += " ";
      continue;
    }
    if (candidate.codePointAt(0)! <= 0xff) out += candidate;
  }
  return out;
}

/** What the file is called when it lands in somebody's downloads. */
export function fileNameFor(view: SheetView, business: string): string {
  const slug = business
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const what = view === "client" ? "weed-sheet" : "weed-reference";
  return `${slug ? `${slug}-` : ""}${what}.pdf`;
}
