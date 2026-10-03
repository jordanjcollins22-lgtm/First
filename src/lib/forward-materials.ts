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

/** How much of an item to buy for a quantity of the service, in the item's own unit, waste in. Null when it can't be said. */
export function buyAmount(item: InventoryItem, quantity: number, unit: ProductionUnit): string | null {
  if (!(quantity > 0)) return null;
  const withWaste = quantity * (1 + Math.max(0, item.wastePct) / 100);
  const itemUnit = (item.unit ?? "").trim();
  // A weight or a length is how it is measured, not what it is bought as: a
  // 40 lb bag "covering 8,000 sq ft" is one bag, not one pound.
  if (/^(lb|lbs|pound|pounds|oz|ounces?|ft|feet|sq)\b/i.test(itemUnit)) return null;
  if (unit === "SF" && item.coverageSqFt && item.coverageSqFt > 0) {
    const n = Math.ceil(withWaste / item.coverageSqFt - 1e-9);
    return `${n} ${itemUnit || (n === 1 ? "unit" : "units")}`;
  }
  if (unit === "CY" && /yard|\byd/i.test(itemUnit)) return `${Math.ceil(withWaste * 2 - 1e-9) / 2} cu yd`;
  if (unit === "plant" && /plant/i.test(itemUnit)) return `${Math.ceil(quantity)} plant${Math.ceil(quantity) === 1 ? "" : "s"}`;
  return null;
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
  items: { item: InventoryItem; buy: string | null }[];
}

/** Every line that uses a material, with its inventory items and how much of each to buy. Disposal and other per-job costs are left out. */
export function jobMaterials(areaNames: string[], lines: PriceLine[][], services: ProductionService[], inventory: InventoryItem[]): MaterialRow[] {
  return lines.flatMap((areaLines, area) =>
    areaLines.flatMap((line) => {
      const service = productionService(line.key, services);
      if (!service || service.unit === "job" || !(line.materialCents > 0 || service.materialName)) return [];
      if (!service.materialName && !service.materialIds?.length) return [];
      return [
        {
          area,
          areaName: areaNames[area] ?? `Area ${area + 1}`,
          service: service.label,
          quantity: line.quantity,
          unit: service.unit,
          material: service.materialName ?? "Material",
          materialCents: Math.max(0, Math.round(line.materialCents)),
          items: itemsFor(service, inventory).map((item) => ({ item, buy: buyAmount(item, line.quantity, service.unit) })),
        },
      ];
    })
  );
}
