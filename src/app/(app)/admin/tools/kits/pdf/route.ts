import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";

import { checkTabAccess } from "@/lib/data/access";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { listKitTools, toolPhotoJpegUrl } from "@/lib/data/tools";
import { listKitContainers } from "@/lib/data/kit-containers";
import { latin1, truncate, wrapText } from "@/lib/print-text";
import {
  CHECKBOX,
  FONT,
  HEADER_HEIGHT,
  MARGIN,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  QR,
  ROW_GAP,
  columns,
  contentDisposition,
  countLabel,
  kitQuantity,
  layoutFor,
  paginate,
  sheetRows,
  sheetsFor,
  whereLabel,
  type KitSheet,
  type KitTool,
  type Layout,
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

  const [tools, organization, containers] = await Promise.all([
    listKitTools(),
    getCurrentOrganization(),
    // Never fatal. A checklist without the bin named is still the checklist;
    // a download that fails because a container query timed out is not.
    listKitContainers().catch(() => []),
  ]);
  const sheets = sheetsFor(tools, params.get("kit"), containers);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${organization.name} — kit checklist`);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const plain = await pdf.embedFont(StandardFonts.Helvetica);

  // Every photo on every sheet, fetched once. A tool in two kits is embedded
  // once and drawn twice.
  // The biggest box any sheet will draw a photo in, so one fetch serves them
  // all at a size that is never scaled up.
  const widest = sheets.reduce((biggest, sheet) => {
    const layout = layoutFor(sheetRows(sheet).length);
    return Math.max(biggest, layout.photoWidth, layout.photoHeight);
  }, 0);
  const photos = await loadPhotos(pdf, sheets.flatMap((sheet) => sheet.tools), widest);
  const codes = qrCodes(sheets.flatMap((sheet) => sheet.tools));

  const printedOn = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  for (const sheet of sheets) {
    // Worked out per kit: a kit of two gets rows three times the height of a
    // kit of fifteen, because it has the page to spare and the photograph is
    // the part somebody actually reads.
    const rows = sheetRows(sheet);
    const layout = layoutFor(rows.length);
    const pages = paginate(rows, layout.rowsPerPage);
    pages.forEach((toolsOnPage, index) => {
      drawPage(pdf, {
        sheet,
        layout,
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
  layout: Layout;
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
  const col = columns(anyHowTo, input.layout.photoWidth);

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
  const parts = input.sheet.partRows?.length ?? 0;
  const partCount = parts > 0 ? ` · ${parts} bin part${parts === 1 ? "" : "s"}` : "";
  const meta = latin1(`${input.business} · ${count}${partCount} · printed ${input.printedOn}`);
  page.drawText(meta, {
    x: left,
    y: y - FONT.kit - 12,
    size: FONT.meta,
    font: input.plain,
    color: grey,
  });

  // What it all travels in, first, because somebody holding this sheet is
  // stood in front of the thing and needs to know they have the right one.
  // Left off entirely when nobody has said: a line saying nothing is a line
  // that could have been a tool.
  const storedIn = input.sheet.storedIn?.trim();
  const instruction = storedIn
    ? `Stored in: ${storedIn}. Tick each one back in, and check it went to the bin named.`
    : "Tick each one back in, and check it went to the bin named.";
  const room = PAGE_WIDTH - 2 * MARGIN;
  page.drawText(
    latin1(truncate(instruction, room, (line) => input.plain.widthOfTextAtSize(line, FONT.meta))),
    {
      x: left,
      y: y - FONT.kit - 24,
      size: FONT.meta,
      font: input.plain,
      color: grey,
    }
  );

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
    y -= ROW_GAP + input.layout.rowHeight;
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
  const { rowHeight, photoWidth, photoHeight } = input.layout;
  const top = bottom + rowHeight;
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
  const photoY = top - photoHeight;
  if (photo) {
    // Fitted inside the box rather than filling it, so a long-handled tool is
    // still recognisable instead of cropped to its shaft.
    const scale = Math.min(photoWidth / photo.width, photoHeight / photo.height);
    const w = photo.width * scale;
    const h = photo.height * scale;
    page.drawImage(photo, {
      x: photoX + (photoWidth - w) / 2,
      y: photoY + (photoHeight - h) / 2,
      width: w,
      height: h,
    });
  } else {
    page.drawRectangle({
      x: photoX,
      y: photoY,
      width: photoWidth,
      height: photoHeight,
      borderColor: rgb(0.85, 0.85, 0.85),
      borderWidth: 0.7,
    });
    page.drawText("no photo", {
      x: photoX + photoWidth / 2 - 14,
      y: photoY + photoHeight / 2 - 3,
      size: 6.5,
      font: input.plain,
      color: rgb(0.62, 0.62, 0.62),
    });
  }

  // The name, and how many of it when that is not one.
  const textX = left + col.text;
  const count = countLabel(kitQuantity(tool, input.sheet.kit));
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
    drawQr(page, code, left + col.qr, bottom + (rowHeight - QR) / 2, QR);
    page.drawText("how to", {
      x: left + col.qr + 8,
      y: bottom + (rowHeight - QR) / 2 - 7,
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
async function loadPhotos(
  pdf: PDFDocument,
  tools: KitTool[],
  boxPoints: number
): Promise<Map<string, PDFImage>> {
  const side = Math.round(Math.max(60, boxPoints) * PIXELS_PER_POINT);
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
