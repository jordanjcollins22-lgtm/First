/**
 * How a planned post's picture is laid out, chosen per post in the picture
 * editor: the before and after stacked or side by side, each photo filling
 * its space or shown whole, how big the headline is, and how thick the
 * green bar along the bottom is.
 *
 * Phone photos are taller than they are wide, so stacking a before and an
 * after into two wide strips cuts most of each away. Side by side, or shown
 * whole, keeps the work in the picture.
 *
 * Pure, so the picture route and the editor's frames agree to the pixel on
 * the size of every space.
 */

import type { CardStyle } from "@/lib/social-plan";

export type Arrange = "stacked" | "side";
export type Fit = "fill" | "whole";
export type TextSize = "none" | "small" | "medium" | "large";
export type BarSize = "thin" | "normal";

export interface Layout {
  arrange: Arrange;
  fit: Fit;
  text: TextSize;
  bar: BarSize;
}

/** The look every post had before layouts could be chosen. */
export const DEFAULT_LAYOUT: Layout = { arrange: "stacked", fit: "fill", text: "large", bar: "normal" };

export const CARD = { width: 1080, height: 1350 } as const;
/** The white line between a before and an after. */
export const GAP = 8;

export const ARRANGE_LABEL: Record<Arrange, string> = { stacked: "Stacked", side: "Side by side" };
export const FIT_LABEL: Record<Fit, string> = { fill: "Fill the space", whole: "Show whole photo" };
export const TEXT_LABEL: Record<TextSize, string> = { none: "None", small: "Small", medium: "Medium", large: "Large" };
export const BAR_LABEL: Record<BarSize, string> = { thin: "Thin", normal: "Normal" };

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** A layout with every field one of its choices; today's look where a field is missing. */
export function tidyLayout(raw: unknown): Layout {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    arrange: pick(r.arrange, ["stacked", "side"] as const, DEFAULT_LAYOUT.arrange),
    fit: pick(r.fit, ["fill", "whole"] as const, DEFAULT_LAYOUT.fit),
    text: pick(r.text, ["none", "small", "medium", "large"] as const, DEFAULT_LAYOUT.text),
    bar: pick(r.bar, ["thin", "normal"] as const, DEFAULT_LAYOUT.bar),
  };
}

/** The green bar: its height, and the size of what's in it. */
export function barSize(bar: BarSize): { height: number; logo: number; font: number; padX: number } {
  return bar === "thin" ? { height: 76, logo: 44, font: 26, padX: 40 } : { height: 120, logo: 64, font: 34, padX: 48 };
}

/**
 * The headline: the height of its panel under the photos of a before and
 * after (none when there is no headline), and its font size, which on a
 * single photo is drawn over the photo instead.
 */
export function headline(text: TextSize, style: CardStyle): { panel: number; font: number } {
  if (text === "none") return { panel: 0, font: 0 };
  const sizes = {
    small: { panel: 140, split: 44, photo: 52 },
    medium: { panel: 210, split: 52, photo: 62 },
    large: { panel: 290, split: 58, photo: 72 },
  }[text];
  return { panel: style === "split" ? sizes.panel : 0, font: style === "split" ? sizes.split : sizes.photo };
}

export interface Spaces {
  before: { width: number; height: number } | null;
  after: { width: number; height: number };
}

/** The space each photo fills in the finished picture. */
export function photoSpaces(style: CardStyle, layout: Layout): Spaces {
  if (style !== "split") return { before: null, after: { width: CARD.width, height: CARD.height } };
  const area = CARD.height - barSize(layout.bar).height - headline(layout.text, "split").panel;
  if (layout.arrange === "side") {
    const width = Math.floor((CARD.width - GAP) / 2);
    return { before: { width, height: area }, after: { width: CARD.width - GAP - width, height: area } };
  }
  const height = Math.floor((area - GAP) / 2);
  return { before: { width: CARD.width, height }, after: { width: CARD.width, height: area - GAP - height } };
}
