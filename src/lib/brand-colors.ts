/**
 * The brand colour options, for picking one that stands out.
 *
 * Each has a light-mode colour (on white: buttons, links, the header) that
 * keeps white text readable on it, a lifted version for dark mode, and an
 * accent for highlights on trucks, shirts and signs.
 */

export interface BrandOption {
  key: string;
  name: string;
  why: string;
  primary: string;
  primaryDark: string;
  accent: string;
  /** The current colour, shown for comparison. */
  current?: boolean;
  recommended?: boolean;
}

export const BRAND_OPTIONS: BrandOption[] = [
  {
    key: "forest",
    name: "Forest green (today)",
    why: "What the app uses now. Calm, but close to every other landscaper's green, so it blends in.",
    primary: "#2f6d3c",
    primaryDark: "#6fbe7d",
    accent: "#dbe7dc",
    current: true,
  },
  {
    key: "teal-lime",
    name: "Deep teal + lime",
    why: "Still says outdoors, but nobody local uses it. The lime pops on a truck or a yard sign from across the street.",
    primary: "#0f766e",
    primaryDark: "#2dd4bf",
    accent: "#a3e635",
    recommended: true,
  },
  {
    key: "kelly",
    name: "Bright kelly green",
    why: "The same green family, turned up. Louder than today, but still reads as 'another green company'.",
    primary: "#12873d",
    primaryDark: "#4ade80",
    accent: "#bbf7d0",
  },
  {
    key: "charcoal-orange",
    name: "Charcoal + safety orange",
    why: "Stands out the most against green competitors, and orange reads well on uniforms. Feels more 'contractor' than 'garden'.",
    primary: "#c2410c",
    primaryDark: "#fb923c",
    accent: "#1f2937",
  },
];

/** White text on the colour: the WCAG contrast ratio, which needs to be at least 4.5 for normal text. */
export function contrastOnWhite(hex: string): number {
  const lum = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  return Math.round((1.05 / (lum(hex) + 0.05)) * 100) / 100;
}
