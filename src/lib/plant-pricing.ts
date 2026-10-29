/**
 * What a plant from a nursery's weekly list costs us and what we charge for
 * it, worked out the way every forward price is: the plant is M, planting it
 * is crew time at the crew rate, and the price is (M + PLC) ÷ PCM.
 *
 * Pure, so the prices are tested without a database.
 */

import { PRICING_EQUATION, crewRateCents, productionService, projectCostMargin, type PricingEquation, type ProductionService } from "@/lib/forward-pricing";

export interface PlantRow {
  id: string;
  itemCode: string;
  name: string;
  /** As the nursery writes it: 1G, 2G, Quart, 3.25", Flat, DP50. */
  size: string;
  native: string | null;
  hardy: string | null;
  category: string | null;
  program: string | null;
  costCents: number;
  saleCents: number | null;
  /** The last day the sale price holds, YYYY-MM-DD. */
  saleUntil: string | null;
  condition: string | null;
  available: number;
  weekOf: string;
  supplier: string;
}

/** What we pay for one today: the sale price while it holds, else the list price. */
export function costToday(plant: Pick<PlantRow, "costCents" | "saleCents" | "saleUntil">, today: string): number {
  if (plant.saleCents != null && plant.saleUntil != null && today <= plant.saleUntil) return plant.saleCents;
  return plant.costCents;
}

/** Whether the sale price is what we would pay today. */
export function onSale(plant: Pick<PlantRow, "costCents" | "saleCents" | "saleUntil">, today: string): boolean {
  return costToday(plant, today) < plant.costCents;
}

/**
 * The planting service a pot size is planted as: a quart, a small pot or a
 * gallon goes in like a 1 gal plant; 2 and 3 gallon like a 3 gal. A flat or
 * a plug tray is many plants, so it has no single planting.
 */
export function plantingServiceKey(size: string): "plant-install-1gal" | "plant-install-3gal" | null {
  const s = size.trim().toLowerCase();
  if (/^(quart|1q|1g|1 gal|\d+(\.\d+)?")$/.test(s)) return "plant-install-1gal";
  if (/^(2g|3g|2 gal|3 gal)$/.test(s)) return "plant-install-3gal";
  return null;
}

/** The plant alone, marked up like any material: what it costs ÷ PCM. */
export function plantPriceCents(costCents: number, eq: PricingEquation = PRICING_EQUATION): number {
  const pcm = projectCostMargin(eq);
  return pcm > 0 ? Math.round(costCents / pcm) : 0;
}

/**
 * The plant planted: what it costs plus the crew's time to plant it, ÷ PCM.
 * Null for a size with no single planting (a flat, a plug tray). Drive and
 * time off the work are the job's, so they are not in it.
 */
export function installedPriceCents(
  costCents: number,
  size: string,
  eq: PricingEquation = PRICING_EQUATION,
  services?: ProductionService[]
): number | null {
  const key = plantingServiceKey(size);
  const service = key ? productionService(key, services) : null;
  if (!service?.pr) return null;
  const pcm = projectCostMargin(eq);
  if (!(pcm > 0)) return null;
  const labourCents = crewRateCents(eq) / service.pr;
  return Math.round((costCents + labourCents) / pcm);
}

/** Native in the nursery's words: N is the straight species, NS a selection of one. */
export function nativeLabel(native: string | null): string | null {
  const n = (native ?? "").trim().toUpperCase();
  if (n === "N") return "Native";
  if (n === "NS") return "Native cultivar";
  return null;
}
