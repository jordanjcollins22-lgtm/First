import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";

import { COLOURS, posterBookingPath } from "@/lib/neighborhood-poster";
import {
  inchesAndSixteenths,
  MAX_PIECE_HEIGHT,
  MAX_PIECE_WIDTH,
  planPieces,
  SHEET,
  SHEET_MARGIN,
  type Board,
  type Measure,
  type Piece,
  type PiecePlan,
} from "@/lib/poster-pieces";
import { packSheets, type PackedSheet } from "@/lib/sheet-packing";

/**
 * The neighbourhood sign, printed as cutouts.
 *
 * Not a poster cut into sheets. Every phrase is its own shape on its own
 * sheet, printed at the size it will be on the finished sign, cut out on a
 * straight line, and laid on the backing board where the map says. Nothing
 * joins to anything, so nothing has a seam to line up and one wandering cut
 * costs one phrase rather than the whole sign.
 *
 * Every cut is a straight line on purpose. A rounded corner is a pair of
 * scissors and a careful minute; a rectangle is one pass on a paper trimmer,
 * twelve times.
 *
 * Kept out of the route so the geometry can be measured rather than eyeballed:
 * what matters about a sign is where the ink lands, and a drawing function
 * that needs a signed-in request to run is one nobody can check.
 */

const PT = 72;

/** What one sheet can carry, once the printer's own margins are gone. */
const USABLE = { width: MAX_PIECE_WIDTH, height: MAX_PIECE_HEIGHT };

/**
 * The lane left between two cutouts on a sheet.
 *
 * Wide enough to get a blade down without touching either neighbour, and to
 * print the piece's number beside it. Two shapes sharing an edge cannot be cut
 * apart at all.
 */
const GUTTER = 0.3;

export interface SignInput {
  /** The backing board or frame, in inches. Twenty by thirty is the usual. */
  width: number;
  height: number;
  businessName: string;
  /** Where a scan lands. Already absolute. */
  bookingUrl: string;
}

export interface RenderedSign {
  bytes: Uint8Array;
  plan: PiecePlan;
}

export async function renderSign(input: SignInput): Promise<RenderedSign> {
  const board: Board = { width: input.width, height: input.height };

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${input.businessName} — neighbourhood sign, ${board.width} by ${board.height} inches`);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const oblique = await pdf.embedFont(StandardFonts.HelveticaBoldOblique);
  const plain = await pdf.embedFont(StandardFonts.Helvetica);

  // Widths scale linearly with size in every font a PDF ships with, so asking
  // for the width at a size in inches gives an answer in inches.
  const measure: Measure = (text, size, italic) =>
    size <= 0 ? 0 : (italic ? oblique : bold).widthOfTextAtSize(text, size);

  const plan = planPieces(board, input.businessName, measure);
  const code = qrMatrix(input.bookingUrl);

  // Numbered before they are packed, so the number is the piece's place on the
  // sign rather than wherever the packer happened to put it. Somebody reading
  // the map wants to find number seven, not to know it was packed ninth.
  const numbered = plan.pieces.map((piece, i) => ({
    piece,
    number: i + 1,
    width: piece.width,
    height: piece.height,
  }));

  // As many as will fit each sheet and still come apart with a blade. One
  // cutout per sheet made a fourteen-page file of which eleven pages were a
  // strip of words and eight inches of white.
  const sheets = packSheets(numbered, USABLE, GUTTER);

  const sheetOf = new Map<string, number>();
  sheets.forEach((sheet, index) => {
    for (const placed of sheet.placements) sheetOf.set(placed.item.piece.id, index + 1);
  });

  drawMap(pdf, plan, bold, plain, input.businessName, sheets.length);
  drawChecklist(pdf, plan, bold, plain, sheetOf);
  sheets.forEach((sheet, index) => {
    drawSheet(pdf, sheet, index + 1, sheets.length, { bold, oblique, code });
  });

  return { bytes: await pdf.save(), plan };
}

export { posterBookingPath, planPieces };

/**
 * A way to measure type without drawing anything.
 *
 * The page that offers the sign wants to say how many cutouts a frame comes
 * to before somebody presses print, since fourteen sheets is a different
 * decision from four. Counting them means laying the sign out, and laying it
 * out means measuring words, so the fonts come from the same place the drawing
 * gets them and the count cannot disagree with the file.
 */
export async function signMeasure(): Promise<Measure> {
  const pdf = await PDFDocument.create();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const oblique = await pdf.embedFont(StandardFonts.HelveticaBoldOblique);
  return (text, size, italic) =>
    size <= 0 ? 0 : (italic ? oblique : bold).widthOfTextAtSize(text, size);
}

/**
 * The map: the whole sign at a size that fits a sheet, every piece numbered.
 *
 * This is the sheet somebody keeps beside the board while they work. It is
 * not for cutting, so it says so — a numbered outline printed small is
 * otherwise exactly what a set of cutouts looks like.
 */
function drawMap(
  pdf: PDFDocument,
  plan: PiecePlan,
  bold: PDFFont,
  plain: PDFFont,
  businessName: string,
  sheetCount: number
) {
  const page = pdf.addPage([8.5 * PT, 11 * PT]);
  const { board } = plan;

  page.drawText("Where each cutout goes", { x: 0.5 * PT, y: 10.4 * PT, size: 15, font: bold });
  page.drawText(
    `${businessName} · ${board.width} × ${board.height}in board · ${plan.pieces.length} cutouts on ${sheetCount} sheet${sheetCount === 1 ? "" : "s"} · this sheet is not for cutting`,
    { x: 0.5 * PT, y: 10.15 * PT, size: 9, font: plain, color: rgb(0.4, 0.4, 0.4) }
  );

  const room = { width: 7.5, height: 9.3 };
  const scale = Math.min(room.width / board.width, room.height / board.height);
  const drawnWidth = board.width * scale;
  const drawnHeight = board.height * scale;
  const left = (8.5 - drawnWidth) / 2;
  const top = 0.55;

  // The board itself, so the white cutouts have something to sit against.
  page.drawRectangle({
    x: left * PT,
    y: (11 - top - drawnHeight) * PT,
    width: drawnWidth * PT,
    height: drawnHeight * PT,
    color: rgb(0.96, 0.96, 0.96),
    borderColor: rgb(0.3, 0.3, 0.3),
    borderWidth: 1,
  });

  plan.pieces.forEach((piece, i) => {
    const x = left + piece.x * scale;
    const y = top + piece.y * scale;
    const w = piece.width * scale;
    const h = piece.height * scale;
    page.drawRectangle({
      x: x * PT,
      y: (11 - y - h) * PT,
      width: w * PT,
      height: h * PT,
      color: piece.fill ? hex(piece.fill) : rgb(1, 1, 1),
      borderColor: rgb(0.55, 0.55, 0.55),
      borderWidth: 0.5,
    });

    // The words, so the map reads as the sign rather than as a grid of boxes.
    if (piece.kind === "text") {
      const size = Math.min(piece.fontSize * scale * PT, (h * PT) / 1.6);
      const wide = bold.widthOfTextAtSize(piece.text, size);
      if (wide < w * PT) {
        page.drawText(piece.text, {
          x: (x * PT) + (w * PT - wide) / 2,
          y: (11 - y - h) * PT + (h * PT - size * 0.72) / 2,
          size,
          font: bold,
          color: piece.fill ? rgb(1, 1, 1) : hex(piece.colour),
        });
      }
    }

    const label = String(i + 1);
    page.drawText(label, {
      x: (x - 0.16) * PT,
      y: (11 - y - h * 0.5 - 0.05) * PT,
      size: 8,
      font: bold,
      color: rgb(0.2, 0.2, 0.2),
    });
  });

  page.drawText(
    "The list overleaf says which sheet each number is printed on, and where it goes on the board.",
    { x: 0.5 * PT, y: 0.45 * PT, size: 8, font: plain, color: rgb(0.45, 0.45, 0.45) }
  );
}

/**
 * The list: every cutout, its finished size, and where it goes.
 *
 * Columns rather than sentences. Somebody with a tape measure is reading down
 * one number at a time, and a sentence per row makes them find it each time.
 */
function drawChecklist(
  pdf: PDFDocument,
  plan: PiecePlan,
  bold: PDFFont,
  plain: PDFFont,
  sheetOf: Map<string, number>
) {
  const rows = plan.pieces.map((piece, i) => {
    const fromLeft = piece.x;
    const fromRight = plan.board.width - piece.x - piece.width;
    return {
      number: i + 1,
      sheet: String(sheetOf.get(piece.id) ?? "—"),
      what: piece.kind === "qr" ? "The code" : piece.text,
      size: `${inchesAndSixteenths(piece.width)} × ${inchesAndSixteenths(piece.height)}`,
      down: inchesAndSixteenths(piece.y),
      across: Math.abs(fromLeft - fromRight) < 0.05 ? "centred" : inchesAndSixteenths(fromLeft),
    };
  });

  const COLUMNS = { number: 0.5, what: 0.9, sheet: 3.8, size: 4.5, down: 6.0, across: 7.1 };
  const PER_PAGE = 22;

  for (let start = 0; start < rows.length; start += PER_PAGE) {
    const page = pdf.addPage([8.5 * PT, 11 * PT]);
    page.drawText("The cutouts", { x: COLUMNS.number * PT, y: 10.4 * PT, size: 15, font: bold });
    page.drawText(
      `Measured from the top left corner of the ${plan.board.width} × ${plan.board.height}in board.`,
      { x: COLUMNS.number * PT, y: 10.15 * PT, size: 9, font: plain, color: rgb(0.4, 0.4, 0.4) }
    );

    const grey = rgb(0.4, 0.4, 0.4);
    const heading = (text: string, x: number) =>
      page.drawText(text, { x: x * PT, y: 9.8 * PT, size: 7.5, font: bold, color: grey });
    heading("What it says", COLUMNS.what);
    heading("Sheet", COLUMNS.sheet);
    heading("Cut it", COLUMNS.size);
    heading("Down", COLUMNS.down);
    heading("Across", COLUMNS.across);

    let y = 9.5;
    for (const row of rows.slice(start, start + PER_PAGE)) {
      page.drawText(`${row.number}.`, { x: COLUMNS.number * PT, y: y * PT, size: 10, font: bold });
      page.drawText(truncate(row.what, bold, 10, (COLUMNS.sheet - COLUMNS.what - 0.15) * PT), {
        x: COLUMNS.what * PT,
        y: y * PT,
        size: 10,
        font: bold,
      });
      page.drawText(row.sheet, { x: COLUMNS.sheet * PT, y: y * PT, size: 9, font: bold });
      page.drawText(row.size, { x: COLUMNS.size * PT, y: y * PT, size: 9, font: plain, color: grey });
      page.drawText(row.down, { x: COLUMNS.down * PT, y: y * PT, size: 9, font: plain, color: grey });
      page.drawText(row.across, { x: COLUMNS.across * PT, y: y * PT, size: 9, font: plain, color: grey });
      y -= 0.42;
    }

    page.drawText(
      "Across is to the cutout's left edge. Centred means the same gap either side.",
      { x: COLUMNS.number * PT, y: 0.45 * PT, size: 8, font: plain, color: rgb(0.45, 0.45, 0.45) }
    );
  }
}

interface CutoutFonts {
  bold: PDFFont;
  oblique: PDFFont;
  code: { size: number; bits: boolean[] };
}

/** One item as the packer sees it: a cutout that knows its number. */
interface PackedPiece {
  piece: Piece;
  number: number;
  width: number;
  height: number;
}

/**
 * One sheet, carrying as many cutouts as would fit.
 *
 * Printed actual size or the sign comes out the wrong size for the frame, so
 * the sheet says so where somebody will read it.
 *
 * Every number sits in the lane above its cutout rather than on it, which is
 * what makes the lane worth its width twice over: it is where the blade goes
 * and it is where the label goes, and both are gone the moment the piece is
 * cut out. A number printed inside a shape ends up on the finished sign.
 */
function drawSheet(
  pdf: PDFDocument,
  sheet: PackedSheet<PackedPiece>,
  number: number,
  total: number,
  fonts: CutoutFonts
) {
  const page = pdf.addPage([SHEET.width * PT, SHEET.height * PT]);

  // Sheet coordinates run from the top left of the usable area; the page's
  // own origin is bottom left, so y is flipped once, here.
  const px = (x: number) => (SHEET_MARGIN + x) * PT;
  const pyTop = (y: number) => (SHEET.height - SHEET_MARGIN - y) * PT;

  for (const placed of sheet.placements) {
    const { piece } = placed.item;
    const left = px(placed.x);
    const top = pyTop(placed.y);
    const bottom = top - piece.height * PT;

    // The cut line, on the boundary rather than outside it: a guide printed
    // beyond the shape is a grey line left on the sign.
    page.drawRectangle({
      x: left,
      y: bottom,
      width: piece.width * PT,
      height: piece.height * PT,
      color: piece.fill ? hex(piece.fill) : rgb(1, 1, 1),
      borderColor: rgb(0.7, 0.7, 0.7),
      borderWidth: 0.5,
      borderDashArray: [4, 3],
    });

    page.drawText(String(placed.item.number), {
      x: left,
      y: top + 0.06 * PT,
      size: 7,
      font: fonts.bold,
      color: rgb(0.5, 0.5, 0.5),
    });

    if (piece.kind === "qr") {
      drawQr(page, fonts.code, left, bottom, piece.width * PT, hex(COLOURS.ink));
      continue;
    }

    const font = piece.italic ? fonts.oblique : fonts.bold;
    const size = piece.fontSize * PT;
    const wide = font.widthOfTextAtSize(piece.text, size);
    page.drawText(piece.text, {
      x: left + (piece.width * PT - wide) / 2,
      y: top - (0.16 + piece.fontSize * 0.72) * PT,
      size,
      font,
      color: hex(piece.colour),
    });
  }

  // At the foot, so it never crowds the numbers along the top row.
  page.drawText(
    `Sheet ${number} of ${total} · cut along the dashed lines · print actual size, not "fit to page"`,
    { x: 0.25 * PT, y: 0.12 * PT, size: 7.5, font: fonts.bold, color: rgb(0.45, 0.45, 0.45) }
  );
}

function truncate(text: string, font: PDFFont, size: number, room: number): string {
  if (font.widthOfTextAtSize(text, size) <= room) return text;
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`, size) > room) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function qrMatrix(text: string): { size: number; bits: boolean[] } {
  const made = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = made.modules.size;
  const data = made.modules.data;
  return { size, bits: Array.from({ length: size * size }, (_, i) => data[i] === 1) };
}

/**
 * The code, as rectangles.
 *
 * Runs of black modules in a row are merged into one rectangle, which is a
 * tenth of the operators and, more to the point, leaves no hairline seams
 * between neighbouring squares for a printer to render as grey.
 */
function drawQr(
  page: PDFPage,
  matrix: { size: number; bits: boolean[] },
  x: number,
  y: number,
  side: number,
  colour: ReturnType<typeof rgb>
) {
  const QUIET = 2;
  const units = matrix.size + QUIET * 2;
  const unit = side / units;
  page.drawRectangle({ x, y, width: side, height: side, color: rgb(1, 1, 1) });
  for (let r = 0; r < matrix.size; r += 1) {
    let c = 0;
    while (c < matrix.size) {
      if (!matrix.bits[r * matrix.size + c]) {
        c += 1;
        continue;
      }
      let run = 1;
      while (c + run < matrix.size && matrix.bits[r * matrix.size + c + run]) run += 1;
      page.drawRectangle({
        x: x + (QUIET + c) * unit,
        y: y + side - (QUIET + r + 1) * unit,
        width: run * unit,
        height: unit,
        color: colour,
      });
      c += run;
    }
  }
}

function hex(value: string): ReturnType<typeof rgb> {
  const n = parseInt(value.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
