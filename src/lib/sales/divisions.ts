/**
 * Which part of the business a piece of work belongs to, and the gross
 * margin each part is held to.
 *
 * The four divisions are priced differently in the market. Maintenance is
 * repeat work with no materials to speak of and should leave about half its
 * price; install carries plants, stone and soil and runs thinner; snow is
 * sold in advance against an unknown winter; irrigation sits between. The
 * targets are the owner's to change on the Pipeline page. The defaults come
 * from the research report's Level CFO planning bands (maintenance ~50%,
 * install 22-28%, snow 20-28%), rounded up a little so the guardrail errs
 * towards holding a price rather than letting a thin one out.
 *
 * Pure, so the rules are tested without a database.
 */

export const DIVISIONS = ["maintenance", "install", "snow", "irrigation"] as const;
export type Division = (typeof DIVISIONS)[number];

export const DIVISION_LABEL: Record<Division, string> = {
  maintenance: "Maintenance",
  install: "Install",
  snow: "Snow",
  irrigation: "Irrigation",
};

/** Gross margin each division is held to, as a fraction of the price. */
export type DivisionTargets = Record<Division, number>;

export const DEFAULT_DIVISION_TARGETS: DivisionTargets = {
  maintenance: 0.5,
  install: 0.3,
  snow: 0.25,
  irrigation: 0.45,
};

/**
 * Production-rate keys by division. Anything not listed here falls back to
 * the words in its name, then to install, the division with the lowest bar
 * after snow, so an unknown service is never held to a target it was not
 * priced for.
 */
const BY_KEY: Record<string, Division> = {
  "weed-pulling": "maintenance",
  "weed-spraying": "maintenance",
  "perennial-cutback": "maintenance",
  "debris-cleanup": "maintenance",
  "plant-cutback": "maintenance",
  "shrub-trimming": "maintenance",
  "tree-trimming": "maintenance",
  "mulch-install": "maintenance",
  "mowing-edging": "maintenance",
  "overseeding": "maintenance",
  aeration: "maintenance",
  dethatching: "maintenance",
  fertilization: "maintenance",
  "leaf-removal": "maintenance",
  "leaf-removal-heavy": "maintenance",
  "soft-washing": "maintenance",
  "gutter-cleaning": "maintenance",
  "plant-removal-small": "install",
  "plant-removal-medium": "install",
  "bush-removal-large": "install",
  "plant-relocation": "install",
  "plant-install-1gal": "install",
  "plant-install-3gal": "install",
  "rock-install": "install",
  "material-removal": "install",
  "bed-edging": "install",
  "soil-prep": "install",
  "topsoil-install": "install",
  "hand-grading": "install",
  seeding: "install",
  "sod-install": "install",
  "snow-removal": "snow",
  disposal: "install",
};

/** The division a service belongs to, from its key and its name. */
export function divisionOf(keyOrTypeId: string, label = ""): Division {
  const known = BY_KEY[keyOrTypeId];
  if (known) return known;
  const words = `${keyOrTypeId} ${label}`.toLowerCase();
  if (/irrigat|sprinkler|drip line|backflow/.test(words)) return "irrigation";
  if (/snow|salt|ice melt|de-?ic/.test(words)) return "snow";
  if (/mow|lawn care|fertili|weed|trim|prun|leaf|cleanup|clean-up|mulch|wash|gutter|aerat|overseed/.test(words)) return "maintenance";
  return "install";
}

/**
 * The division a whole proposal is judged as: the one carrying the most of
 * its price. A mulch top-up on a big planting job is an install job, and
 * should be held to install's margin, not maintenance's.
 */
export function dominantDivision(lines: { division: Division; priceCents: number }[]): Division {
  const totals = new Map<Division, number>();
  for (const line of lines) totals.set(line.division, (totals.get(line.division) ?? 0) + Math.max(0, line.priceCents));
  let best: Division = "install";
  let bestCents = -1;
  for (const division of DIVISIONS) {
    const cents = totals.get(division) ?? -1;
    if (cents > bestCents) {
      best = division;
      bestCents = cents;
    }
  }
  return best;
}

/** Reads stored targets, keeping the default for anything missing or out of range. */
export function readTargets(raw: Partial<Record<Division, unknown>> | null | undefined): DivisionTargets {
  const out = { ...DEFAULT_DIVISION_TARGETS };
  for (const division of DIVISIONS) {
    const n = Number(raw?.[division]);
    if (raw?.[division] != null && Number.isFinite(n) && n > 0 && n < 1) out[division] = n;
  }
  return out;
}
