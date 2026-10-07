import type { TradeDefinition, TradeKey } from "./types";

/**
 * Trades we can broker: work that a local small business can quote from a
 * scope of work and perform without us on site. `subcontractability` is the
 * scoring weight for "how easy is it to find a sub and price from a quote".
 *
 * Specialty-trade NAICS (2382xx) and building-services NAICS (5617xx) are
 * the bread and butter; general construction (2362xx) is deliberately low
 * because it usually needs bonding, a superintendent and real estimating.
 */
export const TRADES: TradeDefinition[] = [
  {
    key: "landscaping",
    label: "Landscaping & grounds maintenance",
    subSearchQuery: "commercial landscaping company",
    naicsCodes: ["561730"],
    pscPrefixes: ["S208", "S217", "F006"],
    keywords: ["landscap", "grounds maint", "groundskeep", "mowing", "mow ", "mulch", "lawn", "turf", "weed", "vegetation", "brush clear", "herbicide"],
    subcontractability: 0.95,
  },
  {
    key: "tree_service",
    label: "Tree service",
    subSearchQuery: "tree service",
    naicsCodes: ["115310"],
    pscPrefixes: ["F014", "F099"],
    keywords: ["tree remov", "tree trim", "tree service", "arborist", "stump", "hazard tree", "pruning"],
    subcontractability: 0.9,
  },
  {
    key: "janitorial",
    label: "Janitorial & custodial",
    subSearchQuery: "commercial janitorial service",
    naicsCodes: ["561720"],
    pscPrefixes: ["S201"],
    keywords: ["janitor", "custodial", "cleaning service", "housekeeping", "deep clean"],
    subcontractability: 0.9,
  },
  {
    key: "carpet_cleaning",
    label: "Carpet & upholstery cleaning",
    subSearchQuery: "commercial carpet cleaning",
    naicsCodes: ["561740"],
    pscPrefixes: ["S214"],
    keywords: ["carpet clean", "upholstery clean", "floor strip", "strip and wax"],
    subcontractability: 0.9,
  },
  {
    key: "window_cleaning",
    label: "Window cleaning",
    subSearchQuery: "commercial window cleaning",
    naicsCodes: [],
    pscPrefixes: [],
    keywords: ["window clean", "window wash"],
    subcontractability: 0.9,
  },
  {
    key: "pressure_washing",
    label: "Pressure / soft washing",
    subSearchQuery: "commercial pressure washing",
    naicsCodes: ["561790"],
    pscPrefixes: ["S299"],
    keywords: ["pressure wash", "power wash", "soft wash", "building wash", "exterior wash", "hydro wash"],
    subcontractability: 0.95,
  },
  {
    key: "snow_removal",
    label: "Snow removal",
    subSearchQuery: "commercial snow removal",
    naicsCodes: [],
    pscPrefixes: ["S218"],
    keywords: ["snow remov", "snow plow", "snow and ice", "deicing", "de-icing"],
    subcontractability: 0.8,
  },
  {
    key: "pest_control",
    label: "Pest control",
    subSearchQuery: "commercial pest control",
    naicsCodes: ["561710"],
    pscPrefixes: ["S207"],
    keywords: ["pest control", "exterminat", "rodent", "termite", "integrated pest"],
    subcontractability: 0.9,
  },
  {
    key: "waste_hauling",
    label: "Trash, refuse & waste hauling",
    subSearchQuery: "commercial dumpster waste removal",
    naicsCodes: ["562111", "562119"],
    pscPrefixes: ["S205"],
    keywords: ["refuse", "trash", "garbage", "dumpster", "waste remov", "solid waste", "roll-off", "portable toilet", "porta-john", "porta john"],
    subcontractability: 0.85,
  },
  {
    key: "hvac",
    label: "HVAC",
    subSearchQuery: "commercial HVAC repair",
    naicsCodes: [],
    pscPrefixes: ["J041", "N041"],
    keywords: ["hvac", "heat pump", "air condition", "chiller", "boiler", "furnace", "rooftop unit", "rtu ", "ductwork", "mini split", "mini-split"],
    subcontractability: 0.85,
  },
  {
    key: "plumbing",
    label: "Plumbing",
    subSearchQuery: "commercial plumber",
    naicsCodes: [],
    pscPrefixes: ["J045"],
    keywords: ["plumb", "water heater", "backflow", "sewer line", "drain clean", "septic", "grease trap"],
    subcontractability: 0.85,
  },
  {
    key: "electrical",
    label: "Electrical",
    subSearchQuery: "commercial electrician",
    naicsCodes: ["238210"],
    pscPrefixes: ["J059", "J061", "J062"],
    keywords: ["electrical", "lighting", "generator", "light fixture", "led retrofit", "fire alarm"],
    subcontractability: 0.8,
  },
  {
    key: "painting",
    label: "Painting",
    subSearchQuery: "commercial painting contractor",
    naicsCodes: ["238320"],
    pscPrefixes: [],
    keywords: ["painting", "repaint", "paint ", "coating", "epoxy floor"],
    subcontractability: 0.9,
  },
  {
    key: "flooring",
    label: "Flooring",
    subSearchQuery: "commercial flooring contractor",
    naicsCodes: ["238330"],
    pscPrefixes: [],
    keywords: ["flooring", "floor replacement", "carpet replace", "carpet install", "vinyl tile", "lvt", "floor tile"],
    subcontractability: 0.85,
  },
  {
    key: "roofing",
    label: "Roofing",
    subSearchQuery: "commercial roofing contractor",
    naicsCodes: ["238160"],
    pscPrefixes: [],
    keywords: ["roof", "gutter"],
    subcontractability: 0.7,
  },
  {
    key: "doors_windows",
    label: "Doors, windows & glass",
    subSearchQuery: "commercial door repair",
    naicsCodes: ["238350", "238150"],
    pscPrefixes: [],
    keywords: ["door repair", "door replace", "overhead door", "garage door", "roll-up door", "automatic door", "window replace", "glazing", "glass replace"],
    subcontractability: 0.85,
  },
  {
    key: "fencing",
    label: "Fencing & gates",
    subSearchQuery: "commercial fence contractor",
    naicsCodes: [],
    pscPrefixes: [],
    keywords: ["fence", "fencing", "gate repair", "gate replace", "guardrail"],
    subcontractability: 0.9,
  },
  {
    key: "paving_concrete",
    label: "Paving, sealcoat & concrete",
    subSearchQuery: "commercial asphalt paving",
    naicsCodes: ["238110", "238990"],
    pscPrefixes: [],
    keywords: ["asphalt", "paving", "sealcoat", "seal coat", "crack seal", "striping", "concrete", "sidewalk", "parking lot"],
    subcontractability: 0.8,
  },
  {
    key: "moving",
    label: "Moving & relocation",
    subSearchQuery: "commercial movers",
    naicsCodes: ["484210"],
    pscPrefixes: ["V002", "V003"],
    keywords: ["moving service", "relocation service", "furniture mov", "office move", "movers"],
    subcontractability: 0.85,
  },
  {
    key: "general_repair",
    label: "General building repair",
    subSearchQuery: "commercial general contractor handyman",
    naicsCodes: ["236220", "236118"],
    pscPrefixes: ["Z1", "Z2"],
    keywords: ["building repair", "facility repair", "renovat", "repair and alteration", "repairs to building"],
    subcontractability: 0.6,
  },
];

export const TRADE_BY_KEY: Record<TradeKey, TradeDefinition> = Object.fromEntries(
  TRADES.map((t) => [t.key, t])
) as Record<TradeKey, TradeDefinition>;

/** Every NAICS code we have a trade for — used to filter source queries. */
export const TARGET_NAICS = Array.from(new Set(TRADES.flatMap((t) => t.naicsCodes)));

export interface TradeMatch {
  trade: TradeDefinition;
  /** How the match was made — keyword-in-title is the strongest signal. */
  via: Array<"title" | "naics" | "psc" | "description">;
  strength: number;
}

/**
 * Classify a solicitation into a trade. Title keywords beat codes because
 * agencies routinely file HVAC repairs under generic construction NAICS.
 * Returns null when nothing matches — those aren't broker-able by us.
 */
export function classifyTrade(input: {
  title: string;
  naicsCode?: string | null;
  pscCode?: string | null;
  description?: string | null;
  allowed?: TradeKey[];
}): TradeMatch | null {
  const title = ` ${input.title.toLowerCase()} `;
  const pscRaw = (input.pscCode ?? "").toUpperCase();
  // PSCs that start with a digit are products (FSC), not services — the
  // broker-a-local-sub model only covers service and construction work.
  if (/^\d/.test(pscRaw)) return null;
  const description = (input.description ?? "").toLowerCase().slice(0, 4000);
  const psc = (input.pscCode ?? "").toUpperCase();
  const candidates = input.allowed?.length
    ? TRADES.filter((t) => input.allowed!.includes(t.key))
    : TRADES;

  let best: TradeMatch | null = null;
  for (const trade of candidates) {
    const via: TradeMatch["via"] = [];
    let strength = 0;
    if (trade.keywords.some((k) => title.includes(k))) {
      via.push("title");
      strength += 3;
    }
    if (input.naicsCode && trade.naicsCodes.includes(input.naicsCode)) {
      via.push("naics");
      strength += 2;
    }
    if (psc && trade.pscPrefixes.some((p) => psc.startsWith(p))) {
      via.push("psc");
      strength += 1;
    }
    if (strength === 0 && description && trade.keywords.some((k) => description.includes(k))) {
      via.push("description");
      strength += 0.5;
    }
    // Generic catch-all trade only wins when nothing specific matched.
    if (trade.key === "general_repair") strength -= 0.25;
    if (strength > 0 && (!best || strength > best.strength)) {
      best = { trade, via, strength };
    }
  }
  return best;
}
