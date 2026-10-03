/**
 * Company shirts: the designs, the colours and sizes they come in, and an
 * order as a list of lines (this design, this style, this colour, this size,
 * this many, and who it's for). Pure, so the order sheet's counts are tested.
 *
 * The print files are in public/shirts/print, 300 dpi on a transparent
 * background, which is what a print shop asks for. Each side of a design comes
 * in three inks: full colour for light shirts, all white for green shirts,
 * and the colour logo with white letters for black and charcoal.
 */

export type ShirtInk = "color" | "white" | "dark";
export type ShirtSide = "front" | "back";

export interface ShirtColor {
  key: string;
  label: string;
  hex: string;
  ink: ShirtInk;
}

export const SHIRT_COLORS: ShirtColor[] = [
  { key: "forest-green", label: "Forest green", hex: "#234a2e", ink: "white" },
  { key: "black", label: "Black", hex: "#1d1d1f", ink: "dark" },
  { key: "charcoal", label: "Charcoal", hex: "#3b3f43", ink: "dark" },
  { key: "heather-gray", label: "Heather gray", hex: "#c8cacb", ink: "color" },
  { key: "white", label: "White", hex: "#f7f7f5", ink: "color" },
  { key: "safety-green", label: "Safety green", hex: "#cfe83a", ink: "color" },
  { key: "safety-orange", label: "Safety orange", hex: "#ff7b22", ink: "color" },
];

export const SHIRT_STYLES = [
  { key: "tee", label: "T-shirt" },
  { key: "long-sleeve", label: "Long sleeve" },
  { key: "hoodie", label: "Hoodie" },
] as const;
export type ShirtStyle = (typeof SHIRT_STYLES)[number]["key"];

export const SHIRT_SIZES = ["S", "M", "L", "XL", "2XL", "3XL", "4XL"] as const;
export type ShirtSize = (typeof SHIRT_SIZES)[number];

export interface ShirtPrint {
  /** The print file's name, without its ink. */
  art: string;
  /** Where it goes, in words a print shop uses. */
  placement: string;
  /** How wide it prints, in inches. */
  widthIn: number;
}

export interface ShirtDesign {
  key: string;
  label: string;
  blurb: string;
  front: ShirtPrint | null;
  back: ShirtPrint | null;
  /** The colours it is offered in, the first being the one it is shown in. */
  colors: string[];
}

const CHEST: ShirtPrint = { art: "chest", placement: "Left chest", widthIn: 3.5 };

export const SHIRT_DESIGNS: ShirtDesign[] = [
  {
    key: "classic",
    label: "Classic",
    blurb: "The logo on the chest, and the full logo, name and county big on the back. The everyday shirt.",
    front: CHEST,
    back: { art: "classic-back", placement: "Full back, 3 inches below the collar", widthIn: 11.5 },
    colors: ["forest-green", "black", "charcoal", "heather-gray", "white"],
  },
  {
    key: "bold",
    label: "Bold front",
    blurb: "One big logo and the name across the front, nothing on the back. For events and the office.",
    front: { art: "bold-front", placement: "Full front, 3 inches below the collar", widthIn: 10.5 },
    back: null,
    colors: ["black", "forest-green", "charcoal", "heather-gray", "white"],
  },
  {
    key: "crew",
    label: "Crew",
    blurb: "The logo on the chest, and JS LANDSCAPING CREW big across the back, to be seen from the street. Comes in safety colours.",
    front: CHEST,
    back: { art: "crew-back", placement: "Across the upper back, 3 inches below the collar", widthIn: 12 },
    colors: ["safety-green", "safety-orange", "forest-green", "black", "charcoal"],
  },
];

export function shirtDesign(key: string): ShirtDesign | null {
  return SHIRT_DESIGNS.find((d) => d.key === key) ?? null;
}

export function shirtColor(key: string): ShirtColor | null {
  return SHIRT_COLORS.find((c) => c.key === key) ?? null;
}

export function styleLabel(key: string): string {
  return SHIRT_STYLES.find((s) => s.key === key)?.label ?? key;
}

/** The file for one side of a design on one colour, print or preview size. */
export function shirtArt(print: ShirtPrint, color: ShirtColor, size: "print" | "preview"): string {
  // The chest print is the logo alone, so on black it is the colour logo.
  const ink = print.art === "chest" && color.ink === "dark" ? "color" : color.ink;
  return `/shirts/${size}/${print.art}-${ink}.png`;
}

/** One line of an order. */
export interface ShirtLine {
  design: string;
  style: ShirtStyle;
  color: string;
  size: ShirtSize;
  quantity: number;
  /** Who it's for, when it's for somebody. */
  name: string | null;
}

/** A line, made safe; null when it isn't one we make. */
export function readShirtLine(input: unknown): ShirtLine | null {
  const r = (input ?? {}) as Record<string, unknown>;
  const design = shirtDesign(String(r.design ?? ""));
  const color = String(r.color ?? "");
  const style = String(r.style ?? "") as ShirtStyle;
  const size = String(r.size ?? "") as ShirtSize;
  const quantity = Math.round(Number(r.quantity));
  if (!design || !design.colors.includes(color)) return null;
  if (!SHIRT_STYLES.some((s) => s.key === style) || !SHIRT_SIZES.includes(size)) return null;
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 500) return null;
  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 60) : null;
  return { design: design.key, style, color, size, quantity, name };
}

/** One block of the order sheet: a design in a style and colour, with how many of each size. */
export interface ShirtGroup {
  design: string;
  style: ShirtStyle;
  color: string;
  sizes: Partial<Record<ShirtSize, number>>;
  total: number;
  /** Who each is for, by size, when names were given. */
  names: { size: ShirtSize; name: string }[];
}

/** The order as a print shop reads it: grouped by design, style and colour, sizes counted. */
export function groupShirts(lines: ShirtLine[]): ShirtGroup[] {
  const groups = new Map<string, ShirtGroup>();
  for (const l of lines) {
    const id = `${l.design}|${l.style}|${l.color}`;
    const g = groups.get(id) ?? { design: l.design, style: l.style, color: l.color, sizes: {}, total: 0, names: [] };
    g.sizes[l.size] = (g.sizes[l.size] ?? 0) + l.quantity;
    g.total += l.quantity;
    if (l.name) g.names.push({ size: l.size, name: l.name });
    groups.set(id, g);
  }
  const order = (g: ShirtGroup) => [SHIRT_DESIGNS.findIndex((d) => d.key === g.design), SHIRT_STYLES.findIndex((s) => s.key === g.style), SHIRT_COLORS.findIndex((c) => c.key === g.color)];
  return [...groups.values()].sort((a, b) => {
    const [x, y] = [order(a), order(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
}

export function totalShirts(lines: ShirtLine[]): number {
  return lines.reduce((s, l) => s + l.quantity, 0);
}

export type ShirtOrderStatus = "placed" | "ordered" | "received" | "cancelled";

export const SHIRT_STATUS_LABEL: Record<ShirtOrderStatus, string> = {
  placed: "Needs ordering",
  ordered: "Ordered from the printer",
  received: "Received",
  cancelled: "Cancelled",
};
