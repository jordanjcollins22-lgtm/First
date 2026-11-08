/**
 * What a project's tasks need bought, and what the app already knows each of
 * them costs.
 *
 * An inventory tracker linked to the suppliers comes later. Until then a
 * price comes from, in order: a bulk supplier's published price (Admin ›
 * Bulk suppliers), a matching job material in the inventory with a cost on
 * it (Admin › Inventory), or the starting figure forward pricing already uses
 * (src/lib/forward-pricing.ts). Anything with none of those is "price
 * needed": never a made-up number.
 *
 * Pure, so the roll-up is tested without a database.
 */

import { PRODUCTION_SERVICES } from "@/lib/forward-pricing";
import { TONS_PER_YARD_OF_STONE, type SupplierKind } from "@/lib/material-suppliers";
import type { RateUnit } from "@/lib/pricing-variables";

export type MaterialUnit = "CY" | "TON" | "SF" | "LF" | "EA";

export interface MaterialDef {
  key: string;
  name: string;
  unit: MaterialUnit;
  /** The tasks that use it, and how much of it one unit of the task takes. */
  uses: { task: string; per: number }[];
  /** Extra bought for cuts, overlaps and loss. */
  wastePct: number;
  /** Bought in steps of this much: half a yard, a whole plant. */
  step: number;
  /** A bulk supplier kind that sells it, for the supplier price. */
  supplierKind?: SupplierKind;
  /** Words that find it in the inventory. */
  match?: RegExp;
  /** The forward pricing service whose material cost is its starting price. */
  forwardService?: string;
  /** Forward pricing prices stone by the yard; this is sold by the ton. */
  perYardToTon?: boolean;
}

const svc = (key: string) => PRODUCTION_SERVICES.find((s) => s.key === key);

export const MATERIALS: MaterialDef[] = [
  { key: "mulch", name: "Mulch", unit: "CY", uses: [{ task: "bed-installation.mulch-installation", per: 1 }], wastePct: 0, step: 0.5, supplierKind: "mulch", match: /mulch/i, forwardService: "mulch-install" },
  { key: "rock", name: "Decorative rock", unit: "TON", uses: [{ task: "bed-installation.decorative-rock-installation", per: 1 }], wastePct: 0, step: 0.5, supplierKind: "stone", match: /river rock|decorative (rock|stone)/i, forwardService: "rock-install", perYardToTon: true },
  { key: "topsoil", name: "Topsoil", unit: "CY", uses: [{ task: "bed-installation.topsoil-spreading", per: 1 }], wastePct: 0, step: 0.5, supplierKind: "topsoil", match: /topsoil/i, forwardService: "topsoil-install" },
  { key: "compost", name: "Compost", unit: "CY", uses: [{ task: "bed-installation.compost-spreading", per: 1 }], wastePct: 0, step: 0.5, supplierKind: "compost", match: /compost|leaf ?gro/i },
  {
    key: "drainage-stone",
    name: "Drainage stone (#57)",
    unit: "TON",
    uses: [
      { task: "bed-installation.drainage-stone-installation", per: 1 },
      { task: "drainage-and-hardscape.drainage-stone-installation", per: 1 },
    ],
    wastePct: 0,
    step: 0.5,
    match: /#57|drainage stone|clean stone/i,
  },
  { key: "fabric", name: "Landscape fabric", unit: "SF", uses: [{ task: "bed-installation.landscape-fabric-installation", per: 1 }], wastePct: 10, step: 1, match: /landscape fabric|weed barrier/i },
  { key: "staples", name: "Landscape staples", unit: "EA", uses: [{ task: "bed-installation.landscape-staples", per: 1 }], wastePct: 0, step: 1, match: /staple|pin/i },
  { key: "edging", name: "Landscape edging", unit: "LF", uses: [{ task: "bed-installation.landscape-edging-installation", per: 1 }], wastePct: 5, step: 1, match: /edging/i },
  { key: "perennial", name: "Perennials (quart)", unit: "EA", uses: [{ task: "bed-installation.small-perennial-installation", per: 1 }], wastePct: 0, step: 1, match: /perennial/i },
  { key: "plant-1gal", name: "Plants, 1 gal", unit: "EA", uses: [{ task: "bed-installation.one-gallon-plant-installation", per: 1 }], wastePct: 0, step: 1, forwardService: "plant-install-1gal" },
  { key: "shrub-3gal", name: "Shrubs, 3 gal", unit: "EA", uses: [{ task: "bed-installation.three-gallon-shrub-installation", per: 1 }], wastePct: 0, step: 1, forwardService: "plant-install-3gal" },
  { key: "shrub-5gal", name: "Shrubs, 5 gal", unit: "EA", uses: [{ task: "bed-installation.five-gallon-shrub-installation", per: 1 }], wastePct: 0, step: 1 },
  { key: "tree-small", name: "Small trees", unit: "EA", uses: [{ task: "bed-installation.small-tree-installation", per: 1 }], wastePct: 0, step: 1 },
  { key: "sod", name: "Sod", unit: "SF", uses: [{ task: "lawn-services.sod-installation", per: 1 }], wastePct: 5, step: 1, match: /\bsod\b/i, forwardService: "sod-install" },
  {
    key: "seed",
    name: "Grass seed",
    unit: "SF",
    uses: [
      { task: "lawn-services.broadcast-overseeding", per: 1 },
      { task: "lawn-services.slit-seeding", per: 1 },
    ],
    wastePct: 0,
    step: 1,
    forwardService: "overseeding",
  },
  { key: "straw", name: "Straw", unit: "SF", uses: [{ task: "lawn-services.straw-application", per: 1 }], wastePct: 0, step: 1, match: /straw/i },
  { key: "drain-pipe", name: "Drainage pipe", unit: "LF", uses: [{ task: "drainage-and-hardscape.drainage-pipe-installation", per: 1 }], wastePct: 5, step: 1, match: /drain(age)? pipe|corrugated/i },
  { key: "drain-fabric", name: "Drainage fabric", unit: "SF", uses: [{ task: "drainage-and-hardscape.drainage-fabric-installation", per: 1 }], wastePct: 10, step: 1, match: /drainage fabric|geotextile/i },
  { key: "poly-sand", name: "Polymeric sand", unit: "SF", uses: [{ task: "drainage-and-hardscape.polymeric-sand-installation", per: 1 }], wastePct: 0, step: 1, match: /polymeric/i },
];

const BY_TASK = new Map(MATERIALS.flatMap((m) => m.uses.map((u) => [u.task, { material: m, per: u.per }] as const)));

export function materialForTask(task: string): { material: MaterialDef; per: number } | null {
  return BY_TASK.get(task) ?? null;
}

/** What the app knows about prices, gathered by the caller. */
export interface PriceSources {
  /** Published bulk prices: cents a yard or ton, by kind, with who sells it. */
  supplierProducts: { supplier: string; kind: SupplierKind; name: string; unit: "yd" | "ton"; priceCents: number | null }[];
  /** Job materials in the inventory with a cost, dollars a unit. */
  inventory: { name: string; unit: string | null; costPerUnit: number | null }[];
}

export const NO_SOURCES: PriceSources = { supplierProducts: [], inventory: [] };

export interface PricedMaterial {
  key: string;
  name: string;
  unit: MaterialUnit;
  /** What the tasks need, before waste and rounding. */
  needed: number;
  /** What to order: waste added, rounded up to the step. */
  order: number;
  /** Cents a unit, or null: price needed. */
  unitCents: number | null;
  costCents: number | null;
  supplier: string | null;
  /** Where the price came from, in words. */
  source: string;
  /** Which areas use it. */
  areas: string[];
}

/** An inventory unit, as typed, in the units here. Null when it can't be told. */
export function normalUnit(unit: string | null | undefined): MaterialUnit | null {
  const u = (unit ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (/^(cy|cu ?yd|yd|yard|yards|cubic yards?)$/.test(u)) return "CY";
  if (/^(ton|tons|t)$/.test(u)) return "TON";
  if (/^(sf|sq ?ft|square feet|ft2)$/.test(u)) return "SF";
  if (/^(lf|ft|feet|linear feet|lin ft)$/.test(u)) return "LF";
  if (/^(ea|each|unit|units|pcs?|piece|pieces|plant|plants)$/.test(u)) return "EA";
  return null;
}

/** The price a unit and where it came from, for one material. */
export function priceFor(def: MaterialDef, sources: PriceSources): { unitCents: number | null; supplier: string | null; source: string } {
  if (def.supplierKind) {
    const offers = sources.supplierProducts
      .filter((p) => p.kind === def.supplierKind && p.priceCents != null && p.priceCents > 0)
      .map((p) => {
        // Convert to the material's own unit.
        let cents = p.priceCents!;
        if (def.unit === "CY" && p.unit === "ton") cents = cents * TONS_PER_YARD_OF_STONE;
        if (def.unit === "TON" && p.unit === "yd") cents = cents / TONS_PER_YARD_OF_STONE;
        return { ...p, cents: Math.round(cents) };
      })
      .sort((a, b) => a.cents - b.cents);
    if (offers[0]) return { unitCents: offers[0].cents, supplier: offers[0].supplier, source: `Bulk suppliers: ${offers[0].name}` };
  }
  if (def.match) {
    const item = sources.inventory.find((i) => def.match!.test(i.name) && i.costPerUnit != null && i.costPerUnit > 0 && normalUnit(i.unit) === def.unit);
    if (item) return { unitCents: Math.round(item.costPerUnit! * 100), supplier: null, source: `Inventory: ${item.name}` };
  }
  const fwd = def.forwardService ? svc(def.forwardService) : undefined;
  if (fwd?.materialCentsPerUnit) {
    const cents = def.perYardToTon ? Math.round(fwd.materialCentsPerUnit / TONS_PER_YARD_OF_STONE) : fwd.materialCentsPerUnit;
    return { unitCents: cents, supplier: null, source: `Starting figure (${fwd.label}${def.perYardToTon ? `, $${(fwd.materialCentsPerUnit / 100).toFixed(0)}/CY ÷ ${TONS_PER_YARD_OF_STONE} t/CY` : ""})` };
  }
  return { unitCents: null, supplier: null, source: "Price needed" };
}

const roundUp = (n: number, step: number) => (n <= 0 ? 0 : Math.ceil(n / step - 1e-9) * step);

/**
 * Every material a project's tasks need, added up across the areas, with
 * waste, rounded up to what can be bought, and priced where the app has a
 * price. In the order of MATERIALS, so the list reads the same every time.
 */
export function rollUpMaterials(
  lines: { area: string; task: string; quantity: number; unit?: RateUnit }[],
  sources: PriceSources = NO_SOURCES
): PricedMaterial[] {
  const needed = new Map<string, { qty: number; areas: Set<string> }>();
  for (const line of lines) {
    const hit = materialForTask(line.task);
    if (!hit || !(line.quantity > 0)) continue;
    const cur = needed.get(hit.material.key) ?? { qty: 0, areas: new Set<string>() };
    cur.qty += line.quantity * hit.per;
    cur.areas.add(line.area);
    needed.set(hit.material.key, cur);
  }
  return MATERIALS.filter((m) => needed.has(m.key)).map((m) => {
    const n = needed.get(m.key)!;
    const order = roundUp(n.qty * (1 + m.wastePct / 100), m.step);
    const price = priceFor(m, sources);
    return {
      key: m.key,
      name: m.name,
      unit: m.unit,
      needed: n.qty,
      order,
      unitCents: price.unitCents,
      costCents: price.unitCents == null ? null : Math.round(order * price.unitCents),
      supplier: price.supplier,
      source: price.source,
      areas: [...n.areas],
    };
  });
}

/** Yards of material that come in on the truck, for staging: stone by the ton at 1.4 t a yard. */
export function stagedYards(materials: PricedMaterial[]): number {
  return materials.reduce((s, m) => s + (m.unit === "CY" ? m.order : m.unit === "TON" ? m.order / TONS_PER_YARD_OF_STONE : 0), 0);
}
