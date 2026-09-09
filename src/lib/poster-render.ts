import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";

import { COLOURS, posterBookingPath } from "@/lib/neighborhood-poster";
import {
  inchesAndSixteenths,
  placement,
  planPieces,
  SHEET,
  type Board,
  type Measure,
  type Piece,
  type PiecePlan,
} from "@/lib/poster-pieces";

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
/** The margin round a cutout on its sheet, and where the label goes. */
const SHEET_EDGE = 0.3;

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

  drawMap(pdf, plan, bold, plain, input.businessName);
  drawChecklist(pdf, plan, bold, plain);
  for (const [index, piece] of plan.pieces.entries()) {
    drawCutout(pdf, piece, index + 1, plan, { bold, oblique, code });
  }

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
  businessName: string
) {
  const page = pdf.addPage([8.5 * PT, 11 * PT]);
  const { board } = plan;

  page.drawText("Where each cutout goes", { x: 0.5 * PT, y: 10.4 * PT, size: 15, font: bold });
  page.drawText(
    `${businessName} · ${board.width} × ${board.height}in board · ${plan.pieces.length} cutouts · this sheet is not for cutting`,
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
    "Numbers are the page each cutout is printed on, after this sheet and the list.",
    { x: 0.5 * PT, y: 0.45 * PT, size: 8, font: plain, color: rgb(0.45, 0.45, 0.45) }
  );
}

/**
 * The list: every cutout, its finished size, and where it goes.
 *
 * Columns rather than sentences. Somebody with a tape measure is reading down
 * one number at a time, and a sentence per row makes them find it each time.
 */
function drawChecklist(pdf: PDFDocument, plan: PiecePlan, bold: PDFFont, plain: PDFFont) {
  const rows = plan.pieces.map((piece, i) => {
    const fromLeft = piece.x;
    const fromRight = plan.board.width - piece.x - piece.width;
    return {
      number: i + 1,
      what: piece.kind === "qr" ? "The code" : piece.text,
      size: `${inchesAndSixteenths(piece.width)} × ${inchesAndSixteenths(piece.height)}`,
      down: inchesAndSixteenths(piece.y),
      across: Math.abs(fromLeft - fromRight) < 0.05 ? "centred" : inchesAndSixteenths(fromLeft),
    };
  });

  const COLUMNS = { number: 0.5, what: 0.9, size: 4.0, down: 5.6, across: 6.7 };
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
    heading("Cut it", COLUMNS.size);
    heading("Down", COLUMNS.down);
    heading("Across", COLUMNS.across);

    let y = 9.5;
    for (const row of rows.slice(start, start + PER_PAGE)) {
      page.drawText(`${row.number}.`, { x: COLUMNS.number * PT, y: y * PT, size: 10, font: bold });
      page.drawText(truncate(row.what, bold, 10, (COLUMNS.size - COLUMNS.what - 0.15) * PT), {
        x: COLUMNS.what * PT,
        y: y * PT,
        size: 10,
        font: bold,
      });
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

/**
 * One cutout, on its own sheet, at the size it will be on the sign.
 *
 * Printed actual size or the sign comes out wrong, so the sheet says so where
 * somebody will read it. The label sits in the printer's margin outside the
 * cut line, which means it is gone the moment the piece is cut out and cannot
 * end up on the finished sign.
 */
function drawCutout(pdf: PDFDocument, piece: Piece, number: number, plan: PiecePlan, fonts: CutoutFonts) {
  const page = pdf.addPage([SHEET.width * PT, SHEET.height * PT]);

  const x = (SHEET.width - piece.width) / 2;
  const top = Math.max(SHEET_EDGE, (SHEET.height - piece.height) / 2);
  const bottom = SHEET.height - top - piece.height;

  page.drawText(
    `${number} of ${plan.pieces.length} · ${placement(piece, plan.board)} · print actual size, not "fit to page"`,
    { x: 0.25 * PT, y: (SHEET.height - 0.19) * PT, size: 7.5, font: fonts.bold, color: rgb(0.45, 0.45, 0.45) }
  );

  // The cut line, on the boundary rather than outside it: a guide printed
  // beyond the shape is a grey line left on the sign.
  page.drawRectangle({
    x: x * PT,
    y: bottom * PT,
    width: piece.width * PT,
    height: piece.height * PT,
    color: piece.fill ? hex(piece.fill) : rgb(1, 1, 1),
    borderColor: rgb(0.7, 0.7, 0.7),
    borderWidth: 0.5,
    borderDashArray: [4, 3],
  });

  if (piece.kind === "qr") {
    drawQr(page, fonts.code, x * PT, bottom * PT, piece.width * PT, hex(COLOURS.ink));
    return;
  }

  const font = piece.italic ? fonts.oblique : fonts.bold;
  const size = piece.fontSize * PT;
  const wide = font.widthOfTextAtSize(piece.text, size);
  page.drawText(piece.text, {
    x: x * PT + (piece.width * PT - wide) / 2,
    y: (bottom + piece.height) * PT - (0.16 + piece.fontSize * 0.72) * PT,
    size,
    font,
    color: hex(piece.colour),
  });
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
