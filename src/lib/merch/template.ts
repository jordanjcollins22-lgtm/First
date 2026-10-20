/**
 * Merch design templates. A design is an SVG made in any editor (Canva,
 * Illustrator, Figma, Inkscape) with two kinds of swap points:
 *
 * - One rectangle with id="barcode-slot". At print time it is replaced by the
 *   barcode, scaled to fit the rectangle's box.
 * - Optional text tokens like {{name}} or {{phone}} anywhere in the text.
 *   Each token becomes a field on the order form.
 *
 * Everything here is pure string work so it runs anywhere and is easy to test.
 */

export const BARCODE_SLOT_ID = "barcode-slot";

export interface SlotBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TemplateField {
  key: string;
  label: string;
}

const TOKEN_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;
const SLOT_RE = new RegExp(`<rect\\b[^>]*\\bid\\s*=\\s*["']${BARCODE_SLOT_ID}["'][^>]*?\\/?>(?:\\s*<\\/rect>)?`);

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`));
  return match ? match[1] : null;
}

function num(value: string | null): number | null {
  if (value === null) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** Location of the barcode slot, in the design's own coordinate system. */
export function findBarcodeSlot(svg: string): SlotBox | null {
  const match = svg.match(SLOT_RE);
  if (!match) return null;
  const tag = match[0];
  const box = {
    x: num(attr(tag, "x")) ?? 0,
    y: num(attr(tag, "y")) ?? 0,
    width: num(attr(tag, "width")),
    height: num(attr(tag, "height")),
  };
  if (!box.width || !box.height || box.width <= 0 || box.height <= 0) return null;
  return box as SlotBox;
}

function labelFor(key: string) {
  const spaced = key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The {{tokens}} in a design, in order of first appearance. */
export function templateFields(svg: string): TemplateField[] {
  const seen = new Set<string>();
  const fields: TemplateField[] = [];
  for (const match of svg.matchAll(TOKEN_RE)) {
    const key = match[1];
    if (seen.has(key)) continue;
    seen.add(key);
    fields.push({ key, label: labelFor(key) });
  }
  return fields;
}

/** Problems that would stop the design from printing, or [] if it's usable. */
export function validateTemplate(svg: string): string[] {
  const errors: string[] = [];
  if (!/<svg\b/i.test(svg)) errors.push("The file doesn't look like an SVG.");
  if (/<script\b/i.test(svg) || /\son[a-z]+\s*=/i.test(svg)) {
    errors.push("The SVG contains scripts or event handlers. Export it again without them.");
  }
  if (!findBarcodeSlot(svg)) {
    errors.push(
      `Add a rectangle with id="${BARCODE_SLOT_ID}" (with a width and height) where the barcode should go.`
    );
  }
  return errors;
}

export function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Pull the viewBox and inner markup out of a standalone barcode SVG. */
function unwrapSvg(svg: string): { viewBox: string; inner: string } {
  const open = svg.match(/<svg\b[^>]*>/i);
  if (!open) throw new Error("Barcode renderer returned something that isn't an SVG.");
  const viewBox = attr(open[0], "viewBox") ?? "0 0 100 100";
  const start = (open.index ?? 0) + open[0].length;
  const end = svg.lastIndexOf("</svg>");
  return { viewBox, inner: svg.slice(start, end === -1 ? undefined : end) };
}

/**
 * Produce the final, print-ready SVG: barcode dropped into the slot and every
 * {{token}} filled in. Missing values print as blank, never as "{{token}}".
 */
export function renderDesign(
  templateSvg: string,
  input: { barcodeSvg: string; values: Record<string, string> }
): string {
  const slot = findBarcodeSlot(templateSvg);
  if (!slot) throw new Error(`Design has no usable id="${BARCODE_SLOT_ID}" rectangle.`);

  const { viewBox, inner } = unwrapSvg(input.barcodeSvg);
  const barcode =
    `<svg x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${slot.height}" ` +
    `viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;

  return templateSvg
    .replace(SLOT_RE, barcode)
    .replace(TOKEN_RE, (_, key: string) => escapeXml(input.values[key]?.trim() ?? ""));
}

/** Placeholder text for each token, e.g. {{name}} → "Name". Used in previews. */
export function sampleFieldValues(svg: string): Record<string, string> {
  return Object.fromEntries(templateFields(svg).map((f) => [f.key, f.label]));
}

/**
 * Wrap a flat image design (PNG/JPG) in an SVG template. A white patch covers
 * whatever placeholder code is printed in the slot, then the slot rect marks
 * where the real barcode goes.
 */
export function rasterDesignSvg(input: {
  dataUrl: string;
  pixelWidth: number;
  pixelHeight: number;
  /** Physical print width; height follows the image's aspect ratio. */
  printWidthIn: number;
  slot: SlotBox;
}): string {
  const { dataUrl, pixelWidth: w, pixelHeight: h, slot } = input;
  const heightIn = (input.printWidthIn * h) / w;
  const round = (n: number) => Math.round(n * 100) / 100;
  // Quiet zone around the code so stray edges of the old one never show.
  const pad = Math.round(Math.min(slot.width, slot.height) * 0.03);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(input.printWidthIn)}in" height="${round(heightIn)}in" viewBox="0 0 ${w} ${h}">`,
    `<image href="${dataUrl}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none"/>`,
    `<rect x="${round(slot.x - pad)}" y="${round(slot.y - pad)}" width="${round(slot.width + 2 * pad)}" height="${round(slot.height + 2 * pad)}" fill="#ffffff"/>`,
    `<rect id="${BARCODE_SLOT_ID}" x="${round(slot.x)}" y="${round(slot.y)}" width="${round(slot.width)}" height="${round(slot.height)}" fill="none"/>`,
    `</svg>`,
  ].join("\n");
}

/** Physical width (if given in inches) and viewBox width of a design. */
export function findSvgSize(svg: string): { widthIn: number | null; viewBoxWidth: number | null } {
  const open = svg.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const width = attr(open, "width");
  const viewBox = attr(open, "viewBox")?.trim().split(/[\s,]+/).map(Number);
  return {
    widthIn: width && /in\s*$/.test(width) ? num(width) : null,
    viewBoxWidth: viewBox && viewBox.length === 4 && Number.isFinite(viewBox[2]) ? viewBox[2] : null,
  };
}
