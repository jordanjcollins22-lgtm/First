/**
 * The materials a forward price uses, matched to the inventory, so the
 * account manager sees what is going in, how much to buy and where.
 *
 * Each service that uses a material can be linked to inventory items on
 * Production rates. Until it is, its material's name is looked for in the
 * inventory ("Seed and straw" finds the seed and the straw), preferring an
 * item with a link to buy it. A material with no match says so, so the gap
 * can be filled in the inventory.
 *
 * Pure, so the matching is tested without a database.
 */

import { productionService, type PriceLine, type ProductionService, type ProductionUnit } from "@/lib/forward-pricing";

export interface InventoryItem {
  id: string;
  name: string;
  /** What it is sold by: "bag", "cubic yards", "1 Plant". */
  unit: string | null;
  imageUrl: string | null;
  /** Where to buy it. */
  url: string | null;
  /** Square feet one unit covers, when it is spread. */
  coverageSqFt: number | null;
  /** Extra to allow for waste, as a percentage. */
  wastePct: number;
}

/** The words of a material's name worth looking for: "Seed and straw" → seed, straw. */
function words(materialName: string): string[] {
  return materialName
    .toLowerCase()
    .split(/\s+and\s+|[,/&+]/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3)
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));
}

/**
 * The inventory items a service uses: the ones linked on Production rates,
 * or else one per word of its material's name, the first with a link to buy
 * it and the shortest name winning.
 */
export function itemsFor(service: ProductionService, inventory: InventoryItem[]): InventoryItem[] {
  if (service.materialIds) return service.materialIds.flatMap((id) => inventory.filter((i) => i.id === id));
  if (!service.materialName || service.unit === "job") return [];
  const found: InventoryItem[] = [];
  for (const word of words(service.materialName)) {
    const match = inventory
      .filter((i) => i.name.toLowerCase().includes(word) && !found.includes(i))
      .sort((a, b) => Number(Boolean(b.url)) - Number(Boolean(a.url)) || a.name.length - b.name.length)[0];
    if (match) found.push(match);
  }
  return found;
}

const MEASURE = /^(lb|lbs|pound|pounds|oz|ounces?|ft|feet|sq|cubic|cu|yard|yards|yd|gal|gallons?)\b/i;

/** What one purchase of an item is called: its unit when that is a thing you carry ("bag", "bale", "roll"), else a bag. */
export function purchaseNoun(item: InventoryItem): string {
  const unit = (item.unit ?? "").trim().toLowerCase().replace(/^1\s+/, "");
  if (!unit || MEASURE.test(unit) || /^(per|each|unit)/.test(unit)) return "bag";
  return unit.replace(/s$/, "");
}

const plural = (n: number, noun: string) => `${n.toLocaleString("en-US")} ${noun}${n === 1 ? "" : /(sh|ch|s|x)$/.test(noun) ? "es" : "s"}`;

/**
 * How much of the service one purchase of an item covers, in the service's
 * unit: as set on Production rates, or else from the inventory (a bag that
 * covers 5,000 sq ft, an item sold by the yard). Null when it can't be said.
 */
export function holdsFor(item: InventoryItem, service: ProductionService): number | null {
  const set = service.materialHolds?.[item.id];
  if (set != null && set > 0) return set;
  const unit = (item.unit ?? "").trim();
  if (service.unit === "SF" && item.coverageSqFt && item.coverageSqFt > 0) return item.coverageSqFt;
  if (service.unit === "CY" && /yard|\byd/i.test(unit)) return 1;
  if ((service.unit === "plant" || service.unit === "bush") && /plant|bush|each/i.test(unit)) return 1;
  return null;
}

export interface Purchase {
  /** How many to buy, waste in. */
  count: number;
  /** What one is: "bag", "bale", "cu yd". */
  noun: string;
  /** In words: "37 bags". */
  text: string;
}

/** How many of an item to buy for a quantity of the service, waste in. Null when how much one holds isn't known. */
export function purchaseFor(item: InventoryItem, service: ProductionService, quantity: number): Purchase | null {
  const holds = holdsFor(item, service);
  if (!(quantity > 0) || holds == null) return null;
  const withWaste = quantity * (1 + Math.max(0, item.wastePct) / 100);
  // Sold by the yard: to the next half yard.
  if (service.unit === "CY" && holds === 1 && /yard|\byd/i.test(item.unit ?? "") && !service.materialHolds?.[item.id]) {
    const yards = Math.ceil(withWaste * 2 - 1e-9) / 2;
    return { count: yards, noun: "cu yd", text: `${yards} cu yd` };
  }
  const count = Math.ceil(withWaste / holds - 1e-9);
  const noun = purchaseNoun(item);
  return { count, noun, text: plural(count, noun) };
}

/** The starting bulk threshold, in the service's unit, when nothing is set. */
export function bulkThreshold(service: ProductionService): number | null {
  return service.bulkOver ?? null;
}

export interface MaterialRow {
  /** The area's position and name. */
  area: number;
  areaName: string;
  service: string;
  quantity: number;
  unit: ProductionUnit;
  /** The material, as named on Production rates: "Seed and straw". */
  material: string;
  /** M for the line, in cents. */
  materialCents: number;
  /** Bought at the store: each item and how many of it. */
  items: { item: InventoryItem; buy: Purchase | null }[];
  /**
   * Over the bulk threshold: ordered from a bulk supplier instead. The item
   * is the supplier's product, or null when none is set yet.
   */
  bulk: { over: number; item: InventoryItem | null; amount: string } | null;
}

/** How much to order in bulk: yards to the next half yard, anything else to the next whole unit, waste in. */
function bulkAmount(quantity: number, unit: ProductionUnit, wastePct: number): string {
  const withWaste = quantity * (1 + Math.max(0, wastePct) / 100);
  if (unit === "CY") return `${Math.ceil(withWaste * 2 - 1e-9) / 2} cu yd`;
  const n = Math.ceil(withWaste - 1e-9);
  return `${n.toLocaleString("en-US")} ${unit === "SF" ? "sq ft" : unit === "LF" ? "linear ft" : unit}`;
}

/** Every line that uses a material, with what to buy and how many, or the bulk order when it is over the threshold. Disposal and other per-job costs are left out. */
export function jobMaterials(areaNames: string[], lines: PriceLine[][], services: ProductionService[], inventory: InventoryItem[]): MaterialRow[] {
  return lines.flatMap((areaLines, area) =>
    areaLines.flatMap((line) => {
      const service = productionService(line.key, services);
      if (!service || service.unit === "job") return [];
      if (!service.materialName && !service.materialIds?.length) return [];
      const items = itemsFor(service, inventory);
      const over = bulkThreshold(service);
      const bulkItem = service.bulkMaterialId ? (inventory.find((i) => i.id === service.bulkMaterialId) ?? null) : null;
      return [
        {
          area,
          areaName: areaNames[area] ?? `Area ${area + 1}`,
          service: service.label,
          quantity: line.quantity,
          unit: service.unit,
          material: service.materialName ?? "Material",
          materialCents: Math.max(0, Math.round(line.materialCents)),
          items: items.map((item) => ({ item, buy: purchaseFor(item, service, line.quantity) })),
          bulk:
            over != null && line.quantity > over
              ? { over, item: bulkItem, amount: bulkAmount(line.quantity, service.unit, (bulkItem ?? items[0])?.wastePct ?? 0) }
              : null,
        },
      ];
    })
  );
}
