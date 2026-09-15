/**
 * The kit checklist, as measurements.
 *
 * A kit is a set of tools that travels together, and the question at the end
 * of a day is always the same: is everything back, and is it back in the right
 * bin. That question is answered standing at a van with a pen, not at a
 * screen, so the answer is a sheet of paper with a box beside every tool.
 *
 * It is drawn from the tools table each time it is asked for, so a tool added
 * to a kit this morning is on the sheet printed this afternoon. There is no
 * saved copy to go stale, which is the only way a printed thing stays true.
 *
 * No prices. This is handed to whoever is loading the van, and what a hedge
 * trimmer cost is not their business and not the question being asked.
 *
 * Everything here is in points, 72 to the inch, because that is what the
 * drawing code speaks. No drawing happens here: this is the arithmetic, which
 * is the part worth checking.
 */

import { containersForKit, storedInLabel, type KitContainer } from "@/lib/kit-containers";

export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
export const MARGIN = 36;

/** The kit's name, the date, and the column headings. */
export const HEADER_HEIGHT = 62;
/** Room at the foot for the page number and the line about what to do. */
export const FOOTER_HEIGHT = 22;

/**
 * How tall a row may be, and how short.
 *
 * The floor is legibility: below this a photograph is a thumbnail and the
 * point of having one is gone. The ceiling stops a two-tool kit printing two
 * enormous pictures with half a page of white under each.
 */
export const MIN_ROW_HEIGHT = 62;
export const MAX_ROW_HEIGHT = 190;
export const ROW_GAP = 6;

/** How many pages a kit should try to stay within: one sheet, both sides. */
export const TARGET_PAGES = 2;

export const CHECKBOX = 15;
/** Between the box, the photograph, the words, and the code. */
export const COLUMN_GAP = 10;
/** The square the how-to code is drawn in, when a tool has a link. */
export const QR = 44;
/** Photographs are boxed wider than tall: a shovel is a long thin thing. */
export const PHOTO_ASPECT = 1.9;
/** However tall the row, a photograph stops widening here. */
export const MAX_PHOTO_WIDTH = 210;

export const FONT = {
  kit: 17,
  meta: 9,
  heading: 7.5,
  name: 11,
  description: 8.5,
  where: 8.5,
  footer: 7.5,
} as const;

/** A tool, as much of one as a checklist needs. */
export interface KitTool {
  id: string;
  name: string;
  description: string | null;
  imagePath: string | null;
  howToUrl: string | null;
  /** Where it lives when it is not in the van. */
  storageLocation: string | null;
  /** How many we own altogether. Not how many go in a kit. */
  quantity: number | null;
  kits: number[];
  /**
   * How many belong in each kit, keyed by kit number.
   *
   * Only the exceptions. We own three flat shovels and the kit takes one, so
   * an absent entry means one — which is the normal case and not worth
   * writing down for every tool in every kit.
   */
  kitQuantities?: Record<string, number>;
}

export interface KitSheet {
  /** The kit number, or null for the whole inventory. */
  kit: number | null;
  title: string;
  tools: KitTool[];
  /**
   * What the kit travels in, printed at the top.
   *
   * Null when nobody has said, and the line is left off rather than printed
   * empty — a sheet that spends a line saying nothing is a sheet with one
   * fewer tool on it.
   */
  storedIn?: string | null;
  /**
   * The container's own parts, ticked alongside the tools.
   *
   * The dolly, the can, the straps. They are on the sheet because the moment
   * somebody is stood at the van counting things back in is the moment a
   * cracked crate gets noticed, and a crack nobody wrote down is a crack
   * discovered on the next job instead.
   */
  partRows?: KitTool[];
}

/**
 * Everything with a box beside it on one sheet: the tools, then the bin's own
 * parts. The parts go last because the tools are what somebody came to count.
 */
export function sheetRows(sheet: KitSheet): KitTool[] {
  return [...sheet.tools, ...(sheet.partRows ?? [])];
}

/**
 * How one kit's sheet is laid out, worked out from how much is in it.
 *
 * A fixed row height wastes the page. A kit of two tools got the same
 * postage-stamp photograph as a kit of fifteen, on a sheet that was three
 * quarters empty — and the photograph is the part somebody actually uses to
 * tell one shovel from another.
 *
 * So the rows grow to fill whatever is there. The fewest pages that still
 * leave a row legible, then the tallest row those pages allow, then the
 * biggest photograph that row allows.
 */
export interface Layout {
  rowsPerPage: number;
  rowHeight: number;
  photoWidth: number;
  photoHeight: number;
  pages: number;
}

/** The height on a page that rows can actually occupy. */
export function contentHeight(): number {
  return PAGE_HEIGHT - 2 * MARGIN - HEADER_HEIGHT - FOOTER_HEIGHT;
}

export function layoutFor(count: number): Layout {
  const room = contentHeight();
  const tools = Math.max(1, count);

  // Try one page, then two, and only spill past that when a kit is too big
  // for a row on two pages to still be worth looking at.
  let pages = 1;
  let perPage = tools;
  while (heightFor(room, perPage) < MIN_ROW_HEIGHT && pages < TARGET_PAGES) {
    pages += 1;
    perPage = Math.ceil(tools / pages);
  }
  while (heightFor(room, perPage) < MIN_ROW_HEIGHT && perPage > 1) {
    // Past the target: keep the rows legible and take the pages it needs.
    perPage -= 1;
    pages = Math.ceil(tools / perPage);
  }

  const rowHeight = Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, heightFor(room, perPage)));
  const photoHeight = Math.max(30, rowHeight - 8);
  const photoWidth = Math.min(MAX_PHOTO_WIDTH, photoHeight * PHOTO_ASPECT);

  return { rowsPerPage: perPage, rowHeight, photoWidth, photoHeight, pages };
}

function heightFor(room: number, perPage: number): number {
  return (room + ROW_GAP) / Math.max(1, perPage) - ROW_GAP;
}

/** Where each column starts, measured from the page's left margin. */
export interface Columns {
  checkbox: number;
  photo: number;
  text: number;
  textWidth: number;
  qr: number;
}

/**
 * The columns, worked out from the page and the photograph's width.
 *
 * The text column takes whatever is left, which is what stops a bigger
 * photograph silently pushing a tool's name off the edge of the page.
 */
export function columns(hasAnyHowTo: boolean, photoWidth: number): Columns {
  const checkbox = 0;
  const photo = checkbox + CHECKBOX + COLUMN_GAP;
  const text = photo + photoWidth + COLUMN_GAP;
  const usable = PAGE_WIDTH - 2 * MARGIN;
  const qr = usable - QR;
  const textWidth = Math.max(90, (hasAnyHowTo ? qr - COLUMN_GAP : usable) - text);
  return { checkbox, photo, text, textWidth, qr };
}

/**
 * The tools of one kit, split into pages.
 *
 * A kit with nothing in it still gets a page. An empty checklist is a fact
 * worth printing — it says the kit exists and nothing has been put in it,
 * which is different from the kit not being on the pile at all.
 */
export function paginate(tools: KitTool[], perPage = layoutFor(tools.length).rowsPerPage): KitTool[][] {
  if (tools.length === 0) return [[]];
  const pages: KitTool[][] = [];
  for (let i = 0; i < tools.length; i += Math.max(1, perPage)) pages.push(tools.slice(i, i + perPage));
  return pages;
}

/**
 * Which kits exist, from the tools themselves.
 *
 * There is no table of kits — a kit is however many tools claim to be in it.
 * That means a kit comes into existence the moment somebody ticks it on a
 * tool, and this list is right the moment they do.
 */
export function kitNumbers(tools: KitTool[]): number[] {
  const seen = new Set<number>();
  for (const tool of tools) {
    for (const kit of tool.kits ?? []) if (Number.isFinite(kit)) seen.add(kit);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

/** The tools in one kit, in the order somebody would pack them: by name. */
export function toolsInKit(tools: KitTool[], kit: number): KitTool[] {
  return tools
    .filter((tool) => (tool.kits ?? []).includes(kit))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Tools that belong to no kit at all, which is usually an oversight. */
export function toolsInNoKit(tools: KitTool[]): KitTool[] {
  return tools.filter((tool) => (tool.kits ?? []).length === 0).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What to print, from what was asked for.
 *
 * "all" is every kit, each starting its own sheet, because a kit checklist
 * that runs on from the bottom of another kit is one somebody will tick
 * against the wrong van.
 */
export function sheetsFor(
  tools: KitTool[],
  want: string | null,
  containers: readonly KitContainer[] = []
): KitSheet[] {
  const asked = (want ?? "all").trim().toLowerCase();

  if (asked === "inventory") {
    return [
      {
        kit: null,
        title: "Full inventory",
        tools: tools.slice().sort((a, b) => a.name.localeCompare(b.name)),
      },
    ];
  }

  if (asked === "unassigned") {
    return [{ kit: null, title: "Not in any kit", tools: toolsInNoKit(tools) }];
  }

  const forKit = (kit: number): KitSheet => ({
    kit,
    title: `Kit ${kit}`,
    tools: toolsInKit(tools, kit),
    storedIn: storedInLabel(containers, kit),
    partRows: containerRows(containers, kit),
  });

  const one = Number(asked);
  if (Number.isInteger(one) && one > 0) return [forKit(one)];

  return kitNumbers(tools).map(forKit);
}

/**
 * The container's own parts, as rows with a box beside them.
 *
 * Shaped as tools so they need no new drawing code, and because on the page
 * they are the same thing: something that should be there, with a picture of
 * where it goes. What is different is what happens when one is missing — a
 * tool went astray, a snapped bungee has to be bought — and that is why they
 * are named as parts rather than quietly mixed in with the shovels.
 *
 * Only for a rig somebody built. A crate off a shelf has no parts to count,
 * and printing "DeWalt crate: 1 crate" wastes the line.
 */
export function containerRows(containers: readonly KitContainer[], kit: number | null): KitTool[] {
  const rows: KitTool[] = [];
  for (const container of containersForKit(containers, kit)) {
    for (const part of container.parts.slice().sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))) {
      rows.push({
        id: `part:${part.id}`,
        name: part.name,
        description: `Part of the ${container.name}. Check it is not broken.`,
        imagePath: null,
        howToUrl: null,
        storageLocation: container.name,
        quantity: part.quantity,
        kits: kit == null ? [] : [kit],
        kitQuantities: kit == null ? {} : { [String(kit)]: part.quantity },
      });
    }
  }
  return rows;
}

/**
 * How many of this tool belong in this kit.
 *
 * One unless somebody has said otherwise. This used to be the number we own,
 * which is a different fact: three flat shovels in the shop, one in the kit,
 * and a checklist saying "× 3" sends somebody looking for two that were never
 * in the van.
 */
export function kitQuantity(tool: KitTool, kit: number | null): number {
  // The full-inventory sheet is not a kit, so there it is what we own.
  if (kit == null) return Math.max(1, Math.round(tool.quantity ?? 1));
  const raw = tool.kitQuantities?.[String(kit)];
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** How many of it, said only when it is more than one. */
export function countLabel(quantity: number | null): string | null {
  const n = quantity ?? 1;
  return n > 1 ? `\u00d7 ${n}` : null;
}

/** Where it goes back to, or an honest blank. */
export function whereLabel(tool: KitTool): string {
  const where = (tool.storageLocation ?? "").trim();
  return where ? where : "No bin set";
}

/** What the file is called when it lands in somebody's downloads. */
export function fileNameFor(sheets: KitSheet[], business: string): string {
  const slug = business
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const what =
    sheets.length === 1 && sheets[0].kit != null
      ? `kit-${sheets[0].kit}`
      : sheets.length === 1
        ? sheets[0].title.toLowerCase().replace(/[^a-z0-9]+/g, "-")
        : "kits";
  return `${slug ? `${slug}-` : ""}${what}-checklist.pdf`;
}

export function contentDisposition(sheets: KitSheet[], business: string, download: boolean): string {
  return `${download ? "attachment" : "inline"}; filename="${fileNameFor(sheets, business)}"`;
}
