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

export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
export const MARGIN = 36;

/** The kit's name, the date, and the column headings. */
export const HEADER_HEIGHT = 62;
/** Room at the foot for the page number and the line about what to do. */
export const FOOTER_HEIGHT = 22;

/** One tool's row. Tall enough for a photograph somebody can recognise. */
export const ROW_HEIGHT = 62;
export const ROW_GAP = 6;

export const CHECKBOX = 15;
export const PHOTO = 50;
/** Between the box, the photograph, the words, and the code. */
export const COLUMN_GAP = 10;
/** The square the how-to code is drawn in, when a tool has a link. */
export const QR = 44;

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
  /** How many of it belong in the kit. Null reads as one. */
  quantity: number | null;
  kits: number[];
}

export interface KitSheet {
  /** The kit number, or null for the whole inventory. */
  kit: number | null;
  title: string;
  tools: KitTool[];
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
 * The columns, worked out from the page rather than typed in.
 *
 * The text column takes whatever is left, which is what stops a longer photo
 * or a wider code silently pushing a tool's name off the edge.
 */
export function columns(hasAnyHowTo: boolean): Columns {
  const checkbox = 0;
  const photo = checkbox + CHECKBOX + COLUMN_GAP;
  const text = photo + PHOTO + COLUMN_GAP;
  const usable = PAGE_WIDTH - 2 * MARGIN;
  const qr = usable - QR;
  const textWidth = (hasAnyHowTo ? qr - COLUMN_GAP : usable) - text;
  return { checkbox, photo, text, textWidth, qr };
}

/** How many tool rows fit on one page. */
export function rowsPerPage(): number {
  const room = PAGE_HEIGHT - 2 * MARGIN - HEADER_HEIGHT - FOOTER_HEIGHT;
  return Math.max(1, Math.floor((room + ROW_GAP) / (ROW_HEIGHT + ROW_GAP)));
}

/**
 * The tools of one kit, split into pages.
 *
 * A kit with nothing in it still gets a page. An empty checklist is a fact
 * worth printing — it says the kit exists and nothing has been put in it,
 * which is different from the kit not being on the pile at all.
 */
export function paginate(tools: KitTool[], perPage = rowsPerPage()): KitTool[][] {
  if (tools.length === 0) return [[]];
  const pages: KitTool[][] = [];
  for (let i = 0; i < tools.length; i += perPage) pages.push(tools.slice(i, i + perPage));
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
export function sheetsFor(tools: KitTool[], want: string | null): KitSheet[] {
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

  const one = Number(asked);
  if (Number.isInteger(one) && one > 0) {
    return [{ kit: one, title: `Kit ${one}`, tools: toolsInKit(tools, one) }];
  }

  return kitNumbers(tools).map((kit) => ({
    kit,
    title: `Kit ${kit}`,
    tools: toolsInKit(tools, kit),
  }));
}

/** How many of it, said only when it is more than one. */
export function countLabel(quantity: number | null): string | null {
  const n = quantity ?? 1;
  return n > 1 ? `× ${n}` : null;
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
