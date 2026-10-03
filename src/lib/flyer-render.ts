import {
  clip,
  degrees,
  Duplex,
  endPath,
  LineCapStyle,
  popGraphicsState,
  PDFDocument,
  PrintScaling,
  pushGraphicsState,
  rectangle,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import QRCode from "qrcode";

import { AD_CONTACT_PHONE, slotsForSide, type Side } from "@/lib/flyer";
import type { SheetSquare } from "@/lib/flyer-sheet";

/**
 * The flyer as a print file: both sides of one sheet, drawn once, then laid
 * down as many times as the load asks for, so the printer gets exactly the
 * flyers wanted and nobody has to type a number of copies.
 *
 * Laid out to the same measurements as the on-screen flyer's print styles:
 * a letter sheet, a fifth of an inch in from the edge, four squares of 4" by
 * 4.75" a tenth of an inch apart, and the blue strip along the bottom. The
 * sides are drawn once and placed as a reference on every sheet, so a
 * thousand flyers is a small file and not a thousand copies of every picture.
 *
 * The file asks the printer for both sides, flipped on the long edge, at
 * actual size. Most print dialogs take that as the starting setting; the
 * page still says to check it, because a dialog is free to ignore it.
 */

const INCH = 72;
const PAGE_W = 8.5 * INCH;
const PAGE_H = 11 * INCH;
const PAD = 0.2 * INCH;
const TILE_W = 4 * INCH;
const TILE_H = 4.75 * INCH;
const GAP = 0.1 * INCH;
const BANNER_H = 0.9 * INCH;

const GREEN = hex("#2f9e33");
const LIGHT_GREEN = hex("#68bd45");
const CHARCOAL = hex("#414141");
const BLUE = hex("#2b64b0");
const BANNER_GREEN = hex("#8fd14f");
const WHITE = rgb(1, 1, 1);
const INK = hex("#111111");

export interface FlyerArt {
  /** The eight squares, as the run's sheet composes them. */
  squares: SheetSquare[];
  /** Where an empty square's code points. Null falls back to the phone number. */
  bookingUrl: string | null;
}

interface Fonts {
  bold: PDFFont;
  regular: PDFFont;
}

/** Both sides of one flyer, as a two-page document. */
export async function renderFlyerSides(art: FlyerArt, loadImage: (url: string) => Promise<Uint8Array | null> = fetchImage): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const fonts = { bold: await doc.embedFont(StandardFonts.HelveticaBold), regular: await doc.embedFont(StandardFonts.Helvetica) };
  const qr = art.bookingUrl ? qrMatrix(art.bookingUrl) : null;

  const images = new Map<number, PDFImage | null>();
  await Promise.all(
    art.squares.map(async (square) => {
      if (!square.imageUrl) return;
      const bytes = await loadImage(square.imageUrl).catch(() => null);
      images.set(square.slot, bytes ? await embedAny(doc, bytes) : null);
    })
  );

  for (const side of ["front", "back"] as Side[]) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    for (const position of slotsForSide(side)) {
      const square = art.squares.find((s) => s.slot === position.slot);
      const x = PAD + position.col * (TILE_W + GAP);
      const y = PAGE_H - PAD - TILE_H - position.row * (TILE_H + GAP);
      const image = images.get(position.slot);
      if (image) drawCover(page, image, x, y, TILE_W, TILE_H);
      else if (square?.imageUrl) drawMissing(page, fonts, x, y, square.businessName);
      else drawEmptyTile(page, fonts, x, y, qr);
    }
    drawBanner(page, fonts);
    if (side === "front") drawIndicia(page, fonts);
  }
  return doc;
}

/**
 * The print file for one load: `count` flyers, front then back, each a
 * reference to the same two drawn sides.
 */
export async function renderFlyerLoad(art: FlyerArt, count: number, loadImage?: (url: string) => Promise<Uint8Array | null>): Promise<Uint8Array> {
  const sides = await renderFlyerSides(art, loadImage);
  const out = await PDFDocument.create();
  // Saved first: pictures and fonts are only written into a document when it
  // is saved, and an unsaved one would hand over sides with holes in them.
  const [front, back] = await out.embedPdf(await sides.save(), [0, 1]);
  for (let i = 0; i < count; i += 1) {
    out.addPage([PAGE_W, PAGE_H]).drawPage(front, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
    out.addPage([PAGE_W, PAGE_H]).drawPage(back, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
  }
  const prefs = out.catalog.getOrCreateViewerPreferences();
  prefs.setDuplex(Duplex.DuplexFlipLongEdge);
  prefs.setPrintScaling(PrintScaling.None);
  prefs.setNumCopies(1);
  out.setTitle(`Flyers x${count}`);
  return out.save();
}

async function fetchImage(url: string): Promise<Uint8Array | null> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}

/** PNG and JPEG go in as they are; anything else a phone might upload is turned into a PNG first. */
async function embedAny(doc: PDFDocument, bytes: Uint8Array): Promise<PDFImage | null> {
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return await doc.embedPng(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await doc.embedJpg(bytes);
    const sharp = (await import("sharp")).default;
    return await doc.embedPng(await sharp(bytes).png().toBuffer());
  } catch {
    return null;
  }
}

/** The picture fills the square and is trimmed to it, like the screen's object-cover. */
function drawCover(page: PDFPage, image: PDFImage, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  page.pushOperators(pushGraphicsState(), rectangle(x, y, w, h), clip(), endPath());
  page.drawImage(image, { x: x + (w - dw) / 2, y: y + (h - dh) / 2, width: dw, height: dh });
  page.pushOperators(popGraphicsState());
}

/** Somebody's artwork that would not load. Loud, so the test sheet catches it before the run does. */
function drawMissing(page: PDFPage, fonts: Fonts, x: number, y: number, name: string | null) {
  page.drawRectangle({ x, y, width: TILE_W, height: TILE_H, borderColor: rgb(0.8, 0, 0), borderWidth: 3 });
  centre(page, fonts.bold, "ARTWORK DIDN'T LOAD", 18, x + TILE_W / 2, y + TILE_H / 2 + 6, rgb(0.8, 0, 0));
  if (name) centre(page, fonts.regular, name, 12, x + TILE_W / 2, y + TILE_H / 2 - 16, CHARCOAL);
}

/** The square nobody has bought, drawn as the screen draws it. */
function drawEmptyTile(page: PDFPage, fonts: Fonts, x: number, y: number, qr: { size: number; bits: boolean[] } | null) {
  page.drawRectangle({ x, y, width: TILE_W, height: TILE_H, color: WHITE });
  const inset = 1.2;
  page.drawRectangle({
    x: x + inset,
    y: y + inset,
    width: TILE_W - inset * 2,
    height: TILE_H - inset * 2,
    borderColor: GREEN,
    borderWidth: 2.25,
    borderDashArray: [7, 4],
  });

  const cx = x + TILE_W / 2;
  const qrSide = qr ? 74 : 0;
  // Heights of each line, top to bottom, so the whole block can be centred.
  const blocks = [42, 8, 31, 4, 31, 7, 17, 7, 24, 9, 30, qr ? 8 : 6, qrSide, qr ? 6 : 0, 15];
  const total = blocks.reduce((a, b) => a + b, 0);
  let top = y + (TILE_H + total) / 2;
  const take = (h: number) => {
    const at = top;
    top -= h;
    return at;
  };

  // Megaphone, tipped back like the artwork.
  const megaTop = take(blocks[0]);
  const scale = 1.75;
  const mx = cx - (30 * scale) / 2 + 2;
  page.drawSvgPath("M3 11 L21 6 L21 18 L3 14 Z", { x: mx, y: megaTop - 2, scale, color: CHARCOAL, rotate: degrees(12) });
  page.drawSvgPath("M11.6 16.8 A3 3 0 1 1 5.8 15.2", { x: mx, y: megaTop - 2, scale, borderColor: CHARCOAL, borderWidth: 2.4 * scale, borderLineCap: LineCapStyle.Round, rotate: degrees(12) });
  for (const d of ["M23 6 L27 3", "M23.5 12 L28 12", "M23 18 L27 21"]) {
    page.drawSvgPath(d, { x: mx, y: megaTop - 2, scale, borderColor: CHARCOAL, borderWidth: 1.8 * scale, borderLineCap: LineCapStyle.Round, rotate: degrees(12) });
  }
  take(blocks[1]);

  centre(page, fonts.bold, "YOUR AD", 36, cx, take(blocks[2]) - 27, CHARCOAL);
  take(blocks[3]);
  const hereTop = take(blocks[4]);
  centre(page, fonts.bold, "HERE!", 36, cx, hereTop - 27, CHARCOAL);
  const hereW = fonts.bold.widthOfTextAtSize("HERE!", 36);
  for (const dir of [-1, 1]) {
    const start = dir < 0 ? cx - hereW / 2 - 8 - 20 : cx + hereW / 2 + 8;
    page.drawRectangle({ x: start, y: hereTop - 13, width: 20, height: 1.6, color: GREEN });
    page.drawRectangle({ x: start, y: hereTop - 17.5, width: 20, height: 1.6, color: GREEN });
  }
  take(blocks[5]);

  drawStar(page, cx, take(blocks[6]) - blocks[6] / 2, blocks[6] / 2, GREEN);
  take(blocks[7]);

  // The ribbon, notched at both ends.
  const ribbonTop = take(blocks[8]);
  const rw = (TILE_W - TILE_W * 0.14) * 0.94;
  const rh = blocks[8];
  const notch = rw * 0.04;
  page.drawSvgPath(`M0 0 L${rw} 0 L${rw - notch} ${rh / 2} L${rw} ${rh} L0 ${rh} L${notch} ${rh / 2} Z`, { x: cx - rw / 2, y: ribbonTop, color: GREEN });
  centre(page, fonts.bold, "RESERVE THIS SPACE TODAY!", 12, cx, ribbonTop - rh / 2 - 4.3, WHITE);
  take(blocks[9]);

  const textTop = take(blocks[10]);
  centre(page, fonts.regular, "Get your business in front of", 12.5, cx, textTop - 11, CHARCOAL);
  centre(page, fonts.regular, "local homeowners.", 12.5, cx, textTop - 26, CHARCOAL);
  take(blocks[11]);

  if (qr) {
    const qrTop = take(blocks[12]);
    drawQr(page, qr, cx - qrSide / 2, qrTop - qrSide, qrSide, INK);
    take(blocks[13]);
    centre(page, fonts.bold, "SCAN TO BOOK YOUR SPOT", 14, cx, take(blocks[14]) - 12, LIGHT_GREEN);
  } else {
    take(blocks[12]);
    take(blocks[13]);
    centre(page, fonts.bold, `CALL: ${AD_CONTACT_PHONE}`, 17, cx, take(blocks[14]) - 13, LIGHT_GREEN);
  }
}

/** The blue strip along the bottom of every sheet. */
function drawBanner(page: PDFPage, fonts: Fonts) {
  const width = PAGE_W - PAD * 2;
  page.drawRectangle({ x: PAD, y: PAD, width, height: BANNER_H, color: BLUE });
  centre(page, fonts.bold, "SUPPORT LOCAL BUSINESSES!", 22, PAGE_W / 2, PAD + BANNER_H / 2 + 3, WHITE);
  centre(page, fonts.bold, "THANK YOU FOR SUPPORTING OUR COMMUNITY.", 14.5, PAGE_W / 2, PAD + BANNER_H / 2 - 16, BANNER_GREEN);
}

/** The postage indicia over the corner of our own square, where the screen puts it. */
function drawIndicia(page: PDFPage, fonts: Fonts) {
  const width = PAGE_W * 0.155;
  const right = PAGE_W * 0.034;
  const top = PAGE_H * 0.019;
  const lines: [string, number][] = [
    ["PRSRT STD", 8.2],
    ["ECRWSS", 8.2],
    ["U.S. POSTAGE", 8.2],
    ["PAID", 10.4],
    ["EDDM RETAIL", 8.2],
  ];
  const height = lines.reduce((sum, [, size]) => sum + size * 1.2, 0) + 6;
  const x = PAGE_W - right - width;
  const y = PAGE_H - top - height;
  page.drawRectangle({ x, y, width, height, color: WHITE, borderColor: INK, borderWidth: 0.75 });
  let at = PAGE_H - top - 3;
  for (const [text, size] of lines) {
    at -= size * 1.2;
    centre(page, fonts.bold, text, size, x + width / 2, at + size * 0.22, INK);
  }
}

function drawStar(page: PDFPage, cx: number, cy: number, r: number, color: ReturnType<typeof rgb>) {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(`${(radius * Math.cos(angle)).toFixed(2)} ${(radius * Math.sin(angle)).toFixed(2)}`);
  }
  page.drawSvgPath(`M${points.join(" L")} Z`, { x: cx, y: cy, color });
}

function centre(page: PDFPage, font: PDFFont, text: string, size: number, cx: number, baseline: number, color: ReturnType<typeof rgb>) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: cx - width / 2, y: baseline, size, font, color });
}

function qrMatrix(text: string): { size: number; bits: boolean[] } {
  const made = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = made.modules.size;
  const data = made.modules.data;
  return { size, bits: Array.from({ length: size * size }, (_, i) => data[i] === 1) };
}

/** The code as rectangles, runs merged so there are no seams for the printer to grey. */
function drawQr(page: PDFPage, matrix: { size: number; bits: boolean[] }, x: number, y: number, side: number, colour: ReturnType<typeof rgb>) {
  const QUIET = 2;
  const unit = side / (matrix.size + QUIET * 2);
  page.drawRectangle({ x, y, width: side, height: side, color: WHITE });
  for (let r = 0; r < matrix.size; r += 1) {
    let c = 0;
    while (c < matrix.size) {
      if (!matrix.bits[r * matrix.size + c]) {
        c += 1;
        continue;
      }
      let run = 1;
      while (c + run < matrix.size && matrix.bits[r * matrix.size + c + run]) run += 1;
      page.drawRectangle({ x: x + (QUIET + c) * unit, y: y + side - (QUIET + r + 1) * unit, width: run * unit, height: unit, color: colour });
      c += run;
    }
  }
}

function hex(value: string): ReturnType<typeof rgb> {
  const n = parseInt(value.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
