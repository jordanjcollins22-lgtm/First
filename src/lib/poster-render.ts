import {
  PDFDocument,
  StandardFonts,
  clip,
  closePath,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import QRCode from "qrcode";

import {
  bandFor,
  COLOURS,
  fitToWidth,
  offerLines,
  posterBookingPath,
  scanLayout,
  SIDE_MARGIN,
  WORDS,
} from "@/lib/neighborhood-poster";
import { assemblyOrder, planTiles, tileLabel, type TilePlan } from "@/lib/poster-tiling";

/**
 * The neighbourhood sign, drawn once and cut into sheets a printer can take.
 *
 * Kept out of the route on purpose. What matters about a poster is where the
 * ink lands, and a drawing function that needs a signed-in request to run is
 * one nobody can check. This one takes a size and a name and gives back a
 * file, which means the geometry can be measured rather than eyeballed.
 *
 * Drawn rather than scaled from a picture. A picture big enough for a poster
 * this size would be tens of megabytes, and scaling a small one puts a blurred
 * sign in somebody's window. Lines, boxes and type are as sharp at thirty
 * inches as at three.
 */

const PT = 72;

export interface PosterInput {
  /** The frame, in inches. Twenty by thirty is what is on the shelf. */
  width: number;
  height: number;
  businessName: string;
  /** Where a scan lands. Already absolute. */
  bookingUrl: string;
}

/** The finished file, and what somebody has to do with it. */
export interface RenderedPoster {
  bytes: Uint8Array;
  plan: TilePlan;
}

export async function renderPoster(input: PosterInput): Promise<RenderedPoster> {
  const poster = { width: input.width, height: input.height };
  const plan = planTiles(poster);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${input.businessName} — neighbourhood sign, ${poster.width} by ${poster.height} inches`);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const oblique = await pdf.embedFont(StandardFonts.HelveticaBoldOblique);
  const code = qrMatrix(input.bookingUrl);

  for (const tile of plan.tiles) {
    const page = pdf.addPage([plan.sheet.width * PT, plan.sheet.height * PT]);

    // Everything is drawn in poster coordinates and clipped to this tile, so
    // a word that straddles a seam is drawn twice, once on each sheet, with
    // the halves meeting exactly. The clip is what makes that true: without
    // it every sheet would carry the whole poster.
    const left = plan.offset.x - tile.bleed.left;
    const top = plan.offset.y - tile.bleed.top;
    const clipWidth = tile.source.width + tile.bleed.left + tile.bleed.right;
    const clipHeight = tile.source.height + tile.bleed.top + tile.bleed.bottom;

    const cx0 = left * PT;
    const cx1 = (left + clipWidth) * PT;
    const cy0 = (plan.sheet.height - top - clipHeight) * PT;
    const cy1 = (plan.sheet.height - top) * PT;
    page.pushOperators(
      pushGraphicsState(),
      moveTo(cx0, cy0),
      lineTo(cx1, cy0),
      lineTo(cx1, cy1),
      lineTo(cx0, cy1),
      closePath(),
      clip(),
      endPath()
    );

    drawPoster(page, {
      bold,
      oblique,
      organization: input.businessName,
      code,
      poster,
      sheet: plan.sheet,
      // Where the poster's own top left corner falls on this sheet.
      originX: plan.offset.x - tile.source.x,
      originY: plan.offset.y - tile.source.y,
      clip: { x: left, y: top, width: clipWidth, height: clipHeight },
    });

    page.pushOperators(popGraphicsState());

    drawTrimMarks(page, plan);
    drawSheetLabel(
      page,
      bold,
      `${tileLabel(tile, plan)} · ${input.businessName} · ${poster.width}×${poster.height}in`,
      plan
    );
  }

  return { bytes: await pdf.save(), plan };
}

export { posterBookingPath };


interface DrawInput {
  bold: PDFFont;
  oblique: PDFFont;
  organization: string;
  code: { size: number; bits: boolean[] };
  poster: { width: number; height: number };
  sheet: { width: number; height: number };
  originX: number;
  originY: number;
  clip: { x: number; y: number; width: number; height: number };
}

/**
 * The whole sign, drawn as though the sheet were the poster.
 *
 * The clip is what makes the tiling work: every sheet draws all of it, and
 * only the part inside the clip lands on the paper. Nothing here knows or
 * cares which sheet it is on, which is why the seams line up.
 */
function drawPoster(page: PDFPage, input: DrawInput) {
  const { poster, bold, oblique } = input;
  const deep = hex(COLOURS.deep);
  const bright = hex(COLOURS.bright);
  const ink = hex(COLOURS.ink);

  // Poster inches to page points, with the poster's top left wherever this
  // sheet puts it and y counted downwards, the way a person reads a poster.
  const px = (x: number) => (input.originX + x) * PT;
  const py = (y: number) => (input.sheet.height - (input.originY + y)) * PT;

  page.drawRectangle({
    x: input.clip.x * PT,
    y: (input.sheet.height - input.clip.y - input.clip.height) * PT,
    width: input.clip.width * PT,
    height: input.clip.height * PT,
    color: hex(COLOURS.paper),
  });

  const margin = poster.width * SIDE_MARGIN;
  const usable = poster.width - 2 * margin;

  // The name, once. A real logo goes here when there is one; until then the
  // business's own name set in type, which reads from the pavement and is
  // right for whoever is printing it. A second fixed word under it printed
  // "LANDSCAPING" twice for a business called J's Landscaping.
  const logo = bandFor("logo");
  const logoTop = logo.top * poster.height;
  const logoHeight = (logo.bottom - logo.top) * poster.height;
  const name = input.organization.toUpperCase();
  const nameSize = fitToWidth(name, usable, logoHeight * 0.7, (s) => bold.widthOfTextAtSize(name, s));
  centred(page, name, bold, nameSize, px, py, poster, logoTop + logoHeight * 0.78, ink);
  page.drawRectangle({
    x: px(margin),
    y: py(logoTop + logoHeight),
    width: usable * PT,
    height: poster.height * 0.006 * PT,
    color: bright,
  });

  // "WE'RE WORKING", the biggest black line on the sign, with the marks the
  // reference has either side of it: they cost four lines and they are the
  // difference between a sign and a memo.
  const working = bandFor("working");
  const workingMid = (working.top + (working.bottom - working.top) * 0.55) * poster.height;
  drawBand(page, "working", WORDS.working, bold, ink, px, py, poster, margin, usable);
  drawBursts(page, px, py, poster, margin * 0.55, workingMid, bright);
  drawBursts(page, px, py, poster, poster.width - margin * 0.55, workingMid, bright, -1);

  // "IN YOUR NEIGHBORHOOD", green, so the two lines read as two facts.
  drawBand(page, "neighborhood", WORDS.neighborhood, bold, deep, px, py, poster, margin, usable);

  // The offer, in a box, because it is the only thing on here a stranger is
  // deciding about and it has to be findable from a moving car.
  const offer = bandFor("offer");
  const boxTop = offer.top * poster.height;
  const boxHeight = (offer.bottom - offer.top) * poster.height;
  const radius = poster.width * 0.03;
  roundedBox(page, px(margin), py(boxTop + boxHeight), usable * PT, boxHeight * PT, radius * PT, bright);
  const inset = poster.width * 0.012;
  roundedBox(
    page,
    px(margin + inset),
    py(boxTop + boxHeight - inset),
    (usable - 2 * inset) * PT,
    (boxHeight - 2 * inset) * PT,
    (radius - inset) * PT,
    deep
  );

  // The rows are worked out rather than guessed: a short word set to a width
  // is a tall word, and DISCOUNT was coming out half an inch taller than
  // NEIGHBORHOOD and printing straight through it.
  const inner = usable - 4 * inset;
  const rows = offerLines(boxHeight, WORDS.offerBig.length);
  const smallSize = fitToWidth(WORDS.offerSmall, inner * 0.45, rows.small.maxHeight, (s) =>
    bold.widthOfTextAtSize(WORDS.offerSmall, s)
  );
  centred(page, WORDS.offerSmall, bold, smallSize, px, py, poster, boxTop + rows.small.baseline, hex(COLOURS.paper));
  WORDS.offerBig.forEach((line, i) => {
    const row = rows.big[i];
    const size = fitToWidth(line, inner, row.maxHeight, (s) => bold.widthOfTextAtSize(line, s));
    centred(page, line, bold, size, px, py, poster, boxTop + row.baseline, hex(COLOURS.paper));
  });

  // The bottom row: what to do, the code, and what to do instead.
  const scan = bandFor("scan");
  const scanTop = scan.top * poster.height;
  const scanHeight = (scan.bottom - scan.top) * poster.height;
  const row = scanLayout(poster.width, scanHeight);

  drawQr(page, input.code, px(row.qrLeft), py(scanTop + row.qrSize), row.qrSize * PT, ink);

  // An arrow from the words to the code. The one piece of decoration that is
  // doing a job: it says which of the three things down here to point a phone
  // at, which is otherwise a guess.
  const arrowY = scanTop + poster.height * 0.012;
  const arrowH = poster.height * 0.03;
  const arrowTip = row.arrowRight;
  const arrowTail = arrowTip - poster.width * 0.16;
  page.drawRectangle({
    x: px(arrowTail),
    y: py(arrowY + arrowH * 0.7),
    width: (arrowTip - arrowTail - arrowH) * PT,
    height: arrowH * 0.4 * PT,
    color: bright,
  });
  page.drawSvgPath(
    `M 0 0 L ${arrowH * PT} ${arrowH * 0.5 * PT} L 0 ${arrowH * PT} Z`,
    { x: px(arrowTip - arrowH), y: py(arrowY + arrowH), color: bright, borderWidth: 0 }
  );

  const leftWidth = row.arrowRight - margin;
  const leadSize = fitToWidth(WORDS.scanLead, leftWidth, scanHeight * 0.3, (s) =>
    bold.widthOfTextAtSize(WORDS.scanLead, s)
  );
  page.drawText(WORDS.scanLead, {
    x: px(margin),
    y: py(scanTop + scanHeight * 0.55),
    size: leadSize * PT,
    font: bold,
    color: ink,
  });
  WORDS.scanLines.forEach((line, i) => {
    const size = fitToWidth(line, leftWidth * 0.95, scanHeight * 0.13, (s) => bold.widthOfTextAtSize(line, s));
    page.drawText(line, {
      x: px(margin),
      y: py(scanTop + scanHeight * (0.72 + i * 0.14)),
      size: size * PT,
      font: bold,
      color: ink,
    });
  });

  const rightWidth = poster.width - margin - row.fallbackLeft;
  const titleSize = fitToWidth(WORDS.fallbackTitle, rightWidth, scanHeight * 0.18, (s) =>
    oblique.widthOfTextAtSize(WORDS.fallbackTitle, s)
  );
  page.drawText(WORDS.fallbackTitle, {
    x: px(row.fallbackLeft),
    y: py(scanTop + scanHeight * 0.22),
    size: titleSize * PT,
    font: oblique,
    color: ink,
  });
  page.drawRectangle({
    x: px(row.fallbackLeft),
    y: py(scanTop + scanHeight * 0.3),
    width: rightWidth * 0.8 * PT,
    height: poster.height * 0.004 * PT,
    color: bright,
  });
  WORDS.fallbackLines.forEach((line, i) => {
    const size = fitToWidth(line, rightWidth, scanHeight * 0.15, (s) => bold.widthOfTextAtSize(line, s));
    page.drawText(line, {
      x: px(row.fallbackLeft),
      y: py(scanTop + scanHeight * (0.52 + i * 0.16)),
      size: size * PT,
      font: bold,
      color: ink,
    });
  });

}

/**
 * The three short strokes that flank a shouted line.
 *
 * Drawn rather than set as type because there is no character for them, and
 * because at this size a font's idea of a dash is a hairline.
 */
function drawBursts(
  page: PDFPage,
  px: (x: number) => number,
  py: (y: number) => number,
  poster: { width: number; height: number },
  x: number,
  y: number,
  colour: ReturnType<typeof rgb>,
  direction = 1
) {
  const length = poster.width * 0.035;
  const thickness = poster.height * 0.006;
  const spread = poster.height * 0.022;
  for (const lift of [-spread, 0, spread]) {
    const rise = lift * 0.5;
    page.drawLine({
      start: { x: px(x), y: py(y + lift) },
      end: { x: px(x + direction * length), y: py(y + lift + rise * 0.6) },
      thickness: thickness * PT,
      color: colour,
    });
  }
}

/** One full-width line in its band. */
function drawBand(
  page: PDFPage,
  key: string,
  text: string,
  font: PDFFont,
  colour: ReturnType<typeof rgb>,
  px: (x: number) => number,
  py: (y: number) => number,
  poster: { width: number; height: number },
  margin: number,
  usable: number
) {
  const band = bandFor(key);
  const top = band.top * poster.height;
  const height = (band.bottom - band.top) * poster.height;
  const size = fitToWidth(text, usable, height, (s) => font.widthOfTextAtSize(text, s));
  const wide = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: px(margin + (usable - wide) / 2),
    y: py(top + height * 0.85),
    size: size * PT,
    font,
    color: colour,
  });
}

function centred(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  px: (x: number) => number,
  py: (y: number) => number,
  poster: { width: number; height: number },
  baselineY: number,
  colour: ReturnType<typeof rgb>
) {
  if (size <= 0) return;
  const wide = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: px((poster.width - wide) / 2),
    y: py(baselineY),
    size: size * PT,
    font,
    color: colour,
  });
}

/** A box with round corners, drawn as four lines and four arcs. */
function roundedBox(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  colour: ReturnType<typeof rgb>
) {
  const r = Math.min(radius, width / 2, height / 2);
  page.drawRectangle({ x: x + r, y, width: width - 2 * r, height, color: colour });
  page.drawRectangle({ x, y: y + r, width, height: height - 2 * r, color: colour });
  for (const [cx, cy] of [
    [x + r, y + r],
    [x + width - r, y + r],
    [x + r, y + height - r],
    [x + width - r, y + height - r],
  ]) {
    page.drawCircle({ x: cx, y: cy, size: r, color: colour });
  }
}

/**
 * Where to cut, marked outside the artwork.
 *
 * Only on the edges that meet another sheet. A mark past the poster's own
 * edge is a mark somebody cuts to, and cutting there takes a strip off the
 * finished sign.
 */
function drawTrimMarks(page: PDFPage, plan: TilePlan) {
  const grey = rgb(0.55, 0.55, 0.55);
  const length = 0.22 * PT;
  const gap = 0.04 * PT;
  const x0 = plan.offset.x * PT;
  const x1 = (plan.offset.x + plan.tile.width) * PT;
  const y0 = (plan.sheet.height - plan.offset.y) * PT;
  const y1 = (plan.sheet.height - plan.offset.y - plan.tile.height) * PT;

  const line = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    page.drawLine({ start: a, end: b, thickness: 0.5, color: grey });

  line({ x: x0, y: y0 + gap }, { x: x0, y: y0 + gap + length });
  line({ x: x0, y: y1 - gap }, { x: x0, y: y1 - gap - length });
  line({ x: x0 - gap, y: y0 }, { x: x0 - gap - length, y: y0 });
  line({ x: x0 - gap, y: y1 }, { x: x0 - gap - length, y: y1 });
  line({ x: x1, y: y0 + gap }, { x: x1, y: y0 + gap + length });
  line({ x: x1, y: y1 - gap }, { x: x1, y: y1 - gap - length });
  line({ x: x1 + gap, y: y0 }, { x: x1 + gap + length, y: y0 });
  line({ x: x1 + gap, y: y1 }, { x: x1 + gap + length, y: y1 });
}

/** Which sheet this is, printed where it will be cut off. */
function drawSheetLabel(page: PDFPage, font: PDFFont, text: string, plan: TilePlan) {
  page.drawText(text, {
    x: plan.offset.x * PT,
    y: 0.12 * PT,
    size: 7,
    font,
    color: rgb(0.5, 0.5, 0.5),
  });
  page.drawText(assemblyOrder(plan).slice(0, 110), {
    x: plan.offset.x * PT,
    y: plan.sheet.height * PT - 0.22 * PT,
    size: 7,
    font,
    color: rgb(0.65, 0.65, 0.65),
  });
}

function qrMatrix(text: string): { size: number; bits: boolean[] } {
  const made = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = made.modules.size;
  const data = made.modules.data;
  return { size, bits: Array.from({ length: size * size }, (_, i) => data[i] === 1) };
}

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

