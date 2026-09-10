import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";

import { checkTabAccess } from "@/lib/data/access";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { listKitTools, toolPhotoJpegUrl } from "@/lib/data/tools";
import { latin1, truncate, wrapText } from "@/lib/print-text";
import {
  CHECKBOX,
  FONT,
  HEADER_HEIGHT,
  MARGIN,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  PHOTO,
  QR,
  ROW_GAP,
  ROW_HEIGHT,
  columns,
  contentDisposition,
  countLabel,
  paginate,
  sheetsFor,
  whereLabel,
  type KitSheet,
  type KitTool,
} from "@/lib/kit-sheet";

/**
 * The kit checklist, as a file.
 *
 * A kit is a set of tools that travels together, and the question at the end
 * of a day is always the same: is it all back, and is it back in the right
 * bin. That gets answered standing at a van with a pen, so the answer is a
 * sheet of paper with a box beside every tool, a photograph of it, and where
 * it goes when it is not in the van.
 *
 * Generated rather than saved, so it cannot go stale. Put a tool in a kit this
 * morning and it is on the sheet printed this afternoon.
 *
 * A PDF rather than a page somebody's browser prints, for the reason the weed
 * sheet ended up as one: printing HTML leaves the margins to whichever browser
 * is holding it, and on a phone that meant the top of every page after the
 * first was cut off. A PDF gives the printer coordinates.
 *
 * No prices. This is handed to whoever is loading the van, and what a hedge
 * trimmer cost is neither their business nor the question being asked.
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Photos are asked for at about this many pixels per point, for print. */
const PIXELS_PER_POINT = 4;
/** Fetched in batches, so fifty tools do not open fifty sockets at once. */
const BATCH = 8;

export async function GET(request: Request) {
  const { allowed, profile } = await checkTabAccess("tools");
  if (!profile) return new Response("Sign in first.", { status: 401 });
  if (!allowed) return new Response("Not yours to open.", { status: 403 });

  const params = new URL(request.url).searchParams;
  const download = params.get("download") === "1";

  const [tools, organization] = await Promise.all([listKitTools(), getCurrentOrganization()]);
  const sheets = sheetsFor(tools, params.get("kit"));

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${organization.name} — kit checklist`);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const plain = await pdf.embedFont(StandardFonts.Helvetica);

  // Every photo on every sheet, fetched once. A tool in two kits is embedded
  // once and drawn twice.
  const photos = await loadPhotos(pdf, sheets.flatMap((sheet) => sheet.tools));
  const codes = qrCodes(sheets.flatMap((sheet) => sheet.tools));

  const printedOn = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  for (const sheet of sheets) {
    const pages = paginate(sheet.tools);
    pages.forEach((toolsOnPage, index) => {
      drawPage(pdf, {
        sheet,
        tools: toolsOnPage,
        page: index + 1,
        pages: pages.length,
        bold,
        plain,
        photos,
        codes,
        business: organization.name,
        printedOn,
      });
    });
  }

  const bytes = await pdf.save();
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(sheets, organization.name, download),
      "Content-Length": String(bytes.length),
      // Not "no-store": Safari's viewer wants to hold the file it is showing.
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}

interface PageInput {
  sheet: KitSheet;
  tools: KitTool[];
  page: number;
  pages: number;
  bold: PDFFont;
  plain: PDFFont;
  photos: Map<string, PDFImage>;
  codes: Map<string, { size: number; bits: boolean[] }>;
  business: string;
  printedOn: string;
}

function drawPage(pdf: PDFDocument, input: PageInput) {
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const left = MARGIN;
  const grey = rgb(0.42, 0.42, 0.42);
  const ink = rgb(0.1, 0.1, 0.1);

  const anyHowTo = input.tools.some((tool) => tool.howToUrl);
  const col = columns(anyHowTo);

  // ------------------------------------------------------------- the header
  let y = PAGE_HEIGHT - MARGIN;
  page.drawText(latin1(input.sheet.title), {
    x: left,
    y: y - FONT.kit,
    size: FONT.kit,
    font: input.bold,
    color: ink,
  });

  const count = `${input.sheet.tools.length} ${input.sheet.tools.length === 1 ? "tool" : "tools"}`;
  const meta = latin1(`${input.business} · ${count} · printed ${input.printedOn}`);
  page.drawText(meta, {
    x: left,
    y: y - FONT.kit - 12,
    size: FONT.meta,
    font: input.plain,
    color: grey,
  });

  const instruction = "Tick each one back in, and check it went to the bin named.";
  page.drawText(instruction, {
    x: left,
    y: y - FONT.kit - 24,
    size: FONT.meta,
    font: input.plain,
    color: grey,
  });

  y -= HEADER_HEIGHT;
  page.drawLine({
    start: { x: left, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.7,
    color: rgb(0.8, 0.8, 0.8),
  });

  // -------------------------------------------------------------- the rows
  if (input.tools.length === 0) {
    page.drawText("Nothing is in this kit yet.", {
      x: left,
      y: y - 24,
      size: FONT.name,
      font: input.plain,
      color: grey,
    });
  }

  for (const tool of input.tools) {
    y -= ROW_GAP + ROW_HEIGHT;
    drawRow(page, tool, left, y, col, input);
  }

  // ------------------------------------------------------------- the footer
  const footer =
    input.pages > 1
      ? `${input.sheet.title} · page ${input.page} of ${input.pages}`
      : input.sheet.title;
  page.drawText(latin1(footer), {
    x: left,
    y: MARGIN - 14,
    size: FONT.footer,
    font: input.plain,
    color: rgb(0.55, 0.55, 0.55),
  });
}

/** One tool: a box to tick, a photograph, what it is, and where it goes. */
function drawRow(
  page: PDFPage,
  tool: KitTool,
  left: number,
  bottom: number,
  col: ReturnType<typeof columns>,
  input: PageInput
) {
  const top = bottom + ROW_HEIGHT;
  const grey = rgb(0.42, 0.42, 0.42);

  // The box, big enough to tick with a gloved hand and a biro.
  page.drawRectangle({
    x: left + col.checkbox,
    y: top - CHECKBOX - 4,
    width: CHECKBOX,
    height: CHECKBOX,
    borderColor: rgb(0.35, 0.35, 0.35),
    borderWidth: 1,
  });

  // The photograph, or a box saying there isn't one. A blank would read as a
  // printing fault; this reads as a job somebody can go and do.
  const photo = input.photos.get(tool.id);
  const photoX = left + col.photo;
  const photoY = top - PHOTO;
  if (photo) {
    // Fitted inside the square rather than filled, so a long-handled tool is
    // still recognisable instead of cropped to its shaft.
    const scale = Math.min(PHOTO / photo.width, PHOTO / photo.height);
    const w = photo.width * scale;
    const h = photo.height * scale;
    page.drawImage(photo, { x: photoX + (PHOTO - w) / 2, y: photoY + (PHOTO - h) / 2, width: w, height: h });
  } else {
    page.drawRectangle({
      x: photoX,
      y: photoY,
      width: PHOTO,
      height: PHOTO,
      borderColor: rgb(0.85, 0.85, 0.85),
      borderWidth: 0.7,
    });
    page.drawText("no photo", {
      x: photoX + 7,
      y: photoY + PHOTO / 2 - 3,
      size: 6.5,
      font: input.plain,
      color: rgb(0.62, 0.62, 0.62),
    });
  }

  // The name, and how many of it when that is not one.
  const textX = left + col.text;
  const count = countLabel(tool.quantity);
  const nameWidth = col.textWidth - (count ? 34 : 0);
  const name = truncate(latin1(tool.name), nameWidth, (line) =>
    input.bold.widthOfTextAtSize(line, FONT.name)
  );
  page.drawText(name, { x: textX, y: top - 14, size: FONT.name, font: input.bold, color: rgb(0.1, 0.1, 0.1) });
  if (count) {
    page.drawText(count, {
      x: textX + col.textWidth - input.bold.widthOfTextAtSize(count, FONT.where),
      y: top - 14,
      size: FONT.where,
      font: input.bold,
      color: rgb(0.1, 0.1, 0.1),
    });
  }

  // What it is for. Two lines at most: this is a checklist, not a manual.
  const description = (tool.description ?? "").trim();
  if (description) {
    const lines = wrapText(latin1(description), col.textWidth, 2, (line) =>
      input.plain.widthOfTextAtSize(line, FONT.description)
    );
    lines.forEach((line, i) => {
      page.drawText(line, {
        x: textX,
        y: top - 27 - i * 11,
        size: FONT.description,
        font: input.plain,
        color: grey,
      });
    });
  }

  // Where it goes back to. The whole reason the sheet exists is that this is
  // the bit people get wrong, so it is said on every row whether it is known
  // or not.
  page.drawText(latin1(`Bin: ${whereLabel(tool)}`), {
    x: textX,
    y: bottom + 4,
    size: FONT.where,
    font: input.plain,
    color: grey,
  });

  const code = input.codes.get(tool.id);
  if (code) {
    drawQr(page, code, left + col.qr, bottom + (ROW_HEIGHT - QR) / 2, QR);
    page.drawText("how to", {
      x: left + col.qr + 8,
      y: bottom + (ROW_HEIGHT - QR) / 2 - 7,
      size: 6,
      font: input.plain,
      color: rgb(0.6, 0.6, 0.6),
    });
  }
}

/**
 * Every tool's photograph, embedded once.
 *
 * Asked for as JPEG explicitly: storage answers in whatever the request will
 * take, and a PDF holds one thing. A photo that will not load leaves a marked
 * empty box rather than taking the sheet down with it.
 */
async function loadPhotos(pdf: PDFDocument, tools: KitTool[]): Promise<Map<string, PDFImage>> {
  const side = Math.round(PHOTO * PIXELS_PER_POINT);
  const wanted = tools
    .filter((tool) => tool.imagePath)
    .filter((tool, i, all) => all.findIndex((other) => other.id === tool.id) === i);

  const out = new Map<string, PDFImage>();
  for (let i = 0; i < wanted.length; i += BATCH) {
    await Promise.all(
      wanted.slice(i, i + BATCH).map(async (tool) => {
        try {
          const res = await fetch(toolPhotoJpegUrl(tool.imagePath!, side, side), {
            headers: { Accept: "image/jpeg" },
            cache: "no-store",
          });
          if (!res.ok) return;
          out.set(tool.id, await pdf.embedJpg(await res.arrayBuffer()));
        } catch {
          // An empty box, and the rest of the sheet.
        }
      })
    );
  }
  return out;
}

/** A scannable code for each tool that has somewhere to send somebody. */
function qrCodes(tools: KitTool[]): Map<string, { size: number; bits: boolean[] }> {
  const out = new Map<string, { size: number; bits: boolean[] }>();
  for (const tool of tools) {
    const url = (tool.howToUrl ?? "").trim();
    if (!url || out.has(tool.id)) continue;
    try {
      const made = QRCode.create(url, { errorCorrectionLevel: "M" });
      const size = made.modules.size;
      const data = made.modules.data;
      out.set(tool.id, { size, bits: Array.from({ length: size * size }, (_, i) => data[i] === 1) });
    } catch {
      // A link we cannot encode is a row without a code.
    }
  }
  return out;
}

/** The code, drawn as runs of black rather than one rectangle per module. */
function drawQr(
  page: PDFPage,
  matrix: { size: number; bits: boolean[] },
  x: number,
  y: number,
  side: number
) {
  const QUIET = 2;
  const unit = side / (matrix.size + QUIET * 2);
  const black = rgb(0.1, 0.1, 0.1);
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
        color: black,
      });
      c += run;
    }
  }
}
