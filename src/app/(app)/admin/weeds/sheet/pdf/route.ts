import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";

import { checkTabAccess } from "@/lib/data/access";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { listWeeds, weedPhotoJpegUrl } from "@/lib/data/weeds";
import {
  bookingPath,
  groupWeeds,
  isSheetView,
  rowsOf,
  showsBookingOffer,
  weedScanPath,
  weedsFor,
  type Weed,
} from "@/lib/weeds";
import {
  CELL_GUTTER,
  CELL_PADDING,
  FONT_SIZES,
  GAP,
  LEADING,
  MARGIN_BOTTOM,
  MARGIN_SIDE,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  columnX,
  fileNameFor,
  cellHeight,
  geometryFor,
  latin1,
  paginate,
  truncate,
  wrapText,
  type Block,
  type Geometry,
} from "@/lib/weed-sheet-layout";

/**
 * The weed sheet as a file, rather than as a page somebody's browser prints.
 *
 * Printing HTML puts the layout in the hands of whichever browser is holding
 * it, and they disagree about where the page ends. On a phone this sheet came
 * out twice with the top of the back pages cut off, because the browser used
 * the printer's page box instead of the one the page asked for, and there is
 * no CSS that overrules that. A PDF gives the printer coordinates. Every page
 * here is drawn from its own corner with its own margin, so page four is laid
 * out exactly like page one whatever opens it.
 *
 * The screen sheet stays: it is the quick look, and it still prints. This is
 * the one to send to a printer, and the one to email somebody.
 */

// Sixty-three photographs fetched and embedded is more than the default.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Photos are asked for at about this many pixels per point, for print. */
const PIXELS_PER_POINT = 4;
/** How many photographs to fetch at once. Enough to be quick, few enough to be polite. */
const BATCH = 8;

const INK = rgb(0, 0, 0);
const RULE = rgb(0.72, 0.72, 0.72);
const MUTED = rgb(0.42, 0.42, 0.42);
const PHOTO_BACKING = rgb(0.94, 0.94, 0.94);

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("view");
  const view = isSheetView(raw) ? raw : "client";

  // The same split the page itself makes: the crew's reference is the guide
  // in another shape and is gated like the guide; the client's sheet is a
  // handout and asks only that somebody be signed in.
  const { allowed: canEditGuide, profile } = await checkTabAccess("weeds");
  if (!profile) return new Response("Sign in first.", { status: 401 });
  if (view === "crew" && !canEditGuide) return new Response("Not yours to open.", { status: 403 });

  const [weeds, organization] = await Promise.all([listWeeds(), getCurrentOrganization()]);
  const shown = weedsFor(weeds, view);
  const geometry = geometryFor(view);
  const origin = new URL(request.url).origin;

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${organization.name} — ${view === "client" ? "Common lawn weeds" : "Weed reference"}`);
  pdf.setCreator(organization.name);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const photos = await loadPhotos(pdf, shown, geometry);
  const codes = new Map(shown.map((weed) => [weed.id, qrMatrix(`${origin}${weedScanPath(weed.code)}`)]));

  // What goes on the paper, in order, each piece indivisible.
  const titleHeight = FONT_SIZES.title + 10;
  const headingHeight = FONT_SIZES.heading + 7;
  const ctaHeight = 96;
  const blocks: Block<Weed>[] = [{ kind: "title", height: titleHeight }];
  const heightOfRow = new Map<Weed, number>();
  for (const group of groupWeeds(shown)) {
    blocks.push({ kind: "heading", text: group.group, height: headingHeight });
    for (const row of rowsOf(group.weeds, geometry.columns)) {
      // The row is as tall as the tallest thing in it and no taller. Reserving
      // room for the longest name every weed could have had costs two sheets
      // of paper over sixty-three of them.
      const lines = Math.max(
        ...row.map(
          (weed) =>
            wrapText(latin1(weed.common), geometry.innerWidth, geometry.nameLines, (line) =>
              bold.widthOfTextAtSize(line, FONT_SIZES.name)
            ).length
        ),
        1
      );
      const hasPrep = row.some((weed) => Boolean(weed.prep?.trim()));
      const height = cellHeight(geometry, view, lines, hasPrep);
      heightOfRow.set(row[0], height);
      blocks.push({ kind: "row", weeds: row, height: height + GAP });
    }
  }
  if (showsBookingOffer(view)) blocks.push({ kind: "cta", height: ctaHeight });

  const pages = paginate(blocks, geometry.contentHeight);
  const bookingUrl = `${origin}${bookingPath(organization.slug)}`;
  const bookingCode = qrMatrix(bookingUrl);

  pages.forEach((placed, index) => {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    for (const { block, top } of placed) {
      if (block.kind === "title") {
        drawTitle(page, { bold, regular }, organization.name, view, top);
      } else if (block.kind === "heading") {
        page.drawText(latin1(block.text.toUpperCase()), {
          x: MARGIN_SIDE,
          y: PAGE_HEIGHT - top - FONT_SIZES.heading,
          size: FONT_SIZES.heading,
          font: bold,
          color: MUTED,
        });
      } else if (block.kind === "row") {
        block.weeds.forEach((weed, column) => {
          drawCell(page, { regular, bold, italic }, geometry, view, weed, {
            x: columnX(geometry, column),
            top,
            height: heightOfRow.get(block.weeds[0]) ?? geometry.cellHeight,
            photo: photos.get(weed.id) ?? null,
            code: codes.get(weed.id) ?? null,
          });
        });
      } else {
        drawOffer(page, { regular, bold }, geometry, top, ctaHeight, bookingCode);
      }
    }
    drawFooter(page, regular, organization.name, index + 1, pages.length);
  });

  const bytes = await pdf.save();
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileNameFor(view, organization.name)}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
    },
  });
}

type Fonts = { regular: PDFFont; bold: PDFFont; italic?: PDFFont };
type Embedded = Awaited<ReturnType<PDFDocument["embedJpg"]>>;

/**
 * Every printed photo, fetched as a JPEG and embedded once.
 *
 * A photo that will not load is not an error: the sheet is still the sheet
 * with a grey box where one picture should be, and refusing to make the file
 * because one upload is broken helps nobody standing at a printer.
 */
async function loadPhotos(
  pdf: PDFDocument,
  weeds: Weed[],
  geometry: Geometry
): Promise<Map<string, Embedded>> {
  const width = Math.round(geometry.innerWidth * PIXELS_PER_POINT);
  const height = Math.round(geometry.photoHeight * PIXELS_PER_POINT);
  const wanted = weeds
    .map((weed) => ({ weed, path: weed.photos.find((p) => p.id === weed.printPhotoId)?.path }))
    .filter((x): x is { weed: Weed; path: string } => Boolean(x.path));

  const out = new Map<string, Embedded>();
  for (let i = 0; i < wanted.length; i += BATCH) {
    const batch = wanted.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async ({ weed, path }) => {
        try {
          const res = await fetch(weedPhotoJpegUrl(path, width, height), {
            // Storage answers in whatever the request accepts. Ask for one
            // thing, and every photo comes back as the one thing a PDF holds.
            headers: { Accept: "image/jpeg" },
            cache: "no-store",
          });
          if (!res.ok) return;
          out.set(weed.id, await pdf.embedJpg(await res.arrayBuffer()));
        } catch {
          // A grey box, and the rest of the sheet.
        }
      })
    );
  }
  return out;
}

/** A code as the grid of modules it is, ready to be drawn as rectangles. */
function qrMatrix(text: string): { size: number; bits: boolean[] } {
  // "M" rather than "H": fewer, bigger modules in the same square, which is
  // what decides whether a phone reads a three-quarter-inch code. See lib/qr.ts.
  const made = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = made.modules.size;
  const data = made.modules.data;
  return { size, bits: Array.from({ length: size * size }, (_, i) => data[i] === 1) };
}

/**
 * A code drawn as rectangles, one per run of black rather than one per module.
 *
 * A 29-module code is 841 squares; drawn as runs it is nearer two hundred
 * rectangles, and sixty-three of them on a sheet is the difference between a
 * file that opens at once on a phone and one that does not.
 */
function drawQr(page: PDFPage, matrix: { size: number; bits: boolean[] }, x: number, top: number, side: number) {
  const QUIET = 2;
  const units = matrix.size + QUIET * 2;
  const cellSide = side / units;
  page.drawRectangle({ x, y: PAGE_HEIGHT - top - side, width: side, height: side, color: rgb(1, 1, 1) });
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
        x: x + (QUIET + c) * cellSide,
        y: PAGE_HEIGHT - top - (QUIET + r + 1) * cellSide,
        width: run * cellSide,
        height: cellSide,
        color: INK,
      });
      c += run;
    }
  }
}

function drawTitle(page: PDFPage, fonts: Fonts, business: string, view: string, top: number) {
  const baseline = PAGE_HEIGHT - top - FONT_SIZES.title;
  page.drawText(latin1(`${business} · ${view === "client" ? "Common lawn weeds" : "Weed reference"}`), {
    x: MARGIN_SIDE,
    y: baseline,
    size: FONT_SIZES.title,
    font: fonts.bold,
    color: INK,
  });
  const note = "Scan any weed for more photos";
  page.drawText(note, {
    x: PAGE_WIDTH - MARGIN_SIDE - fonts.regular.widthOfTextAtSize(note, FONT_SIZES.footer),
    y: baseline + 1,
    size: FONT_SIZES.footer,
    font: fonts.regular,
    color: MUTED,
  });
  page.drawLine({
    start: { x: MARGIN_SIDE, y: baseline - 4 },
    end: { x: PAGE_WIDTH - MARGIN_SIDE, y: baseline - 4 },
    thickness: 0.5,
    color: RULE,
  });
}

function drawCell(
  page: PDFPage,
  fonts: Fonts,
  geometry: Geometry,
  view: string,
  weed: Weed,
  at: {
    x: number;
    top: number;
    height: number;
    photo: Embedded | null;
    code: { size: number; bits: boolean[] } | null;
  }
) {
  const { x, top } = at;
  page.drawRectangle({
    x,
    y: PAGE_HEIGHT - top - at.height,
    width: geometry.cellWidth,
    height: at.height,
    borderWidth: 0.5,
    borderColor: RULE,
  });

  const left = x + CELL_PADDING;
  let cursor = top + CELL_PADDING;

  // The photograph, on a grey backing so a weed that has none still reads as
  // a place a picture goes rather than as a hole in the sheet.
  page.drawRectangle({
    x: left,
    y: PAGE_HEIGHT - cursor - geometry.photoHeight,
    width: geometry.innerWidth,
    height: geometry.photoHeight,
    color: PHOTO_BACKING,
  });
  if (at.photo) {
    page.drawImage(at.photo, {
      x: left,
      y: PAGE_HEIGHT - cursor - geometry.photoHeight,
      width: geometry.innerWidth,
      height: geometry.photoHeight,
    });
  }
  cursor += geometry.photoHeight + CELL_GUTTER;

  const measure = (font: PDFFont, size: number) => (line: string) => font.widthOfTextAtSize(line, size);
  const nameLines = wrapText(
    latin1(weed.common),
    geometry.innerWidth,
    geometry.nameLines,
    measure(fonts.bold, FONT_SIZES.name)
  );
  for (const line of nameLines) {
    page.drawText(line, {
      x: left,
      y: PAGE_HEIGHT - cursor - FONT_SIZES.name,
      size: FONT_SIZES.name,
      font: fonts.bold,
      color: INK,
    });
    cursor += LEADING.name;
  }
  // The rest of the name's room is skipped whether it was used or not, so
  // every cell in a row lines up with every other.
  cursor += (geometry.nameLines - nameLines.length) * LEADING.name;

  if (view === "crew") {
    const scientific = truncate(
      latin1(weed.scientific ?? ""),
      geometry.innerWidth,
      measure(fonts.italic ?? fonts.regular, FONT_SIZES.small)
    );
    if (scientific) {
      page.drawText(scientific, {
        x: left,
        y: PAGE_HEIGHT - cursor - FONT_SIZES.small,
        size: FONT_SIZES.small,
        font: fonts.italic ?? fonts.regular,
        color: MUTED,
      });
    }
    cursor += LEADING.small;

    const prep = truncate(latin1(weed.prep ?? ""), geometry.innerWidth, measure(fonts.regular, FONT_SIZES.small));
    if (prep) {
      page.drawText(prep, {
        x: left,
        y: PAGE_HEIGHT - cursor - FONT_SIZES.small,
        size: FONT_SIZES.small,
        font: fonts.regular,
        color: MUTED,
      });
    }
    cursor += LEADING.small;
  }

  cursor = top + at.height - CELL_PADDING - geometry.qrSize;
  if (at.code) drawQr(page, at.code, left, cursor, geometry.qrSize);
  page.drawText(latin1(weed.code), {
    x: left + geometry.qrSize + 4,
    y: PAGE_HEIGHT - cursor - geometry.qrSize / 2,
    size: FONT_SIZES.code,
    font: fonts.bold,
    color: INK,
  });
}

/**
 * The caution and the offer, on the client's sheet only.
 *
 * A homeowner holding this is one scan away from handing the job over, which
 * is the only reason the sheet is worth the paper.
 */
function drawOffer(
  page: PDFPage,
  fonts: Fonts,
  geometry: Geometry,
  top: number,
  height: number,
  code: { size: number; bits: boolean[] }
) {
  const boxTop = top + GAP;
  const boxHeight = height - GAP;
  page.drawRectangle({
    x: MARGIN_SIDE,
    y: PAGE_HEIGHT - boxTop - boxHeight,
    width: geometry.contentWidth,
    height: boxHeight,
    borderWidth: 1.2,
    borderColor: INK,
  });

  const pad = 10;
  const qrSide = boxHeight - 2 * pad;
  const textWidth = geometry.contentWidth - 3 * pad - qrSide;
  let cursor = boxTop + pad;

  page.drawText("Careful pulling these", {
    x: MARGIN_SIDE + pad,
    y: PAGE_HEIGHT - cursor - FONT_SIZES.ctaTitle,
    size: FONT_SIZES.ctaTitle,
    font: fonts.bold,
    color: INK,
  });
  cursor += FONT_SIZES.ctaTitle + 5;

  const body = latin1(
    "Some of these spread if they are not taken out properly. Leave a piece of root behind and one " +
    "plant can come back as several — and a few of them are easier to make worse than to fix."
  );
  for (const line of wrapText(body, textWidth, 3, (l) => fonts.regular.widthOfTextAtSize(l, FONT_SIZES.ctaBody))) {
    page.drawText(line, {
      x: MARGIN_SIDE + pad,
      y: PAGE_HEIGHT - cursor - FONT_SIZES.ctaBody,
      size: FONT_SIZES.ctaBody,
      font: fonts.regular,
      color: INK,
    });
    cursor += LEADING.ctaBody;
  }
  cursor += 3;
  page.drawText("Would you like a hand? Scan to book us.", {
    x: MARGIN_SIDE + pad,
    y: PAGE_HEIGHT - cursor - FONT_SIZES.ctaBody,
    size: FONT_SIZES.ctaBody,
    font: fonts.bold,
    color: INK,
  });

  drawQr(page, code, PAGE_WIDTH - MARGIN_SIDE - pad - qrSide, boxTop + pad, qrSide);
}

/** Which sheet this is and how far through it you are, in the bottom margin. */
function drawFooter(page: PDFPage, font: PDFFont, business: string, number: number, total: number) {
  const y = MARGIN_BOTTOM - FONT_SIZES.footer - 4;
  page.drawText(latin1(business), {
    x: MARGIN_SIDE,
    y,
    size: FONT_SIZES.footer,
    font,
    color: MUTED,
  });
  const label = `Page ${number} of ${total}`;
  page.drawText(label, {
    x: PAGE_WIDTH - MARGIN_SIDE - font.widthOfTextAtSize(label, FONT_SIZES.footer),
    y,
    size: FONT_SIZES.footer,
    font,
    color: MUTED,
  });
}
