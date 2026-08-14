import type { WorkZone } from "@/components/canvas/types";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";

const CUBIC_FEET_PER_YARD = 27;
// Typical loaded wheelbarrow capacity used for hauling estimates.
const WHEELBARROW_CUBIC_FEET = 3;

export function zoneMeasurements(zone: WorkZone): { areaSqFt: number; perimeterFt: number } | null {
  if (zone.areaSqFt == null && zone.perimeterFt == null) return null;
  return { areaSqFt: zone.areaSqFt ?? 0, perimeterFt: zone.perimeterFt ?? 0 };
}

export function formatMeasurements(m: { areaSqFt: number; perimeterFt: number }): string {
  return `${Math.round(m.areaSqFt).toLocaleString()} sq ft · ${Math.round(m.perimeterFt).toLocaleString()} ft perimeter`;
}

/** Paginates the whole-job task list so large jobs don't silently overflow one page. */
export function computeJobTotals(
  zones: WorkZone[],
  catalog: CanvasCatalog
): { totalCost: number; totalHours: number; hasNonFlatRate: boolean } {
  let totalCost = 0;
  let totalHours = 0;
  let hasNonFlatRate = false;
  for (const zone of zones) {
    const service = zone.service;
    if (!service) continue;
    const pricing = catalog.servicePricing.find((p) => p.service_type_id === service.typeId);
    if (!pricing || pricing.status !== "active") continue;
    // A price in the business's own unit ("per sq ft", "per plant", ...)
    // multiplies by whatever that unit is based on; a flat rate, or a unit
    // from some other business, is charged once for the zone.
    const unit = pricing.cost_unit.trim().toLowerCase();
    const measurements = zoneMeasurements(zone);
    const isPerUnit = unit === `per ${catalog.measurementUnit.trim().toLowerCase()}`;
    const quantity = !isPerUnit
      ? null
      : catalog.measurementBasis === "area"
        ? measurements?.areaSqFt ?? 0
        : catalog.measurementBasis === "perimeter"
          ? measurements?.perimeterFt ?? 0
          : null;

    if (pricing.cost != null) {
      totalCost += quantity != null ? pricing.cost * quantity : pricing.cost;
      if (quantity == null && unit !== "flat rate") hasNonFlatRate = true;
    }
    if (quantity != null && pricing.minutes_per_sqft != null) {
      // Crew-hours, not clock-hours — a 3-person crew burns 3x the paid time.
      totalHours += (pricing.minutes_per_sqft / 60) * quantity * (pricing.crew_size ?? 1);
    } else if (pricing.estimated_hours != null) {
      totalHours += pricing.estimated_hours;
    }
  }
  return { totalCost, totalHours, hasNonFlatRate };
}

export interface MaterialLineItem {
  zoneName: string;
  materialId: string;
  material: string;
  unit: string;
  quantity: number;
  totalCost: number | null;
  /** Manually added for this zone rather than computed from a sq-ft rule — no reliable quantity to show. */
  manual?: boolean;
}

export function zoneMaterialLineItems(zone: WorkZone, areaSqFt: number, catalog: CanvasCatalog): MaterialLineItem[] {
  const service = zone.service;
  if (!service) return [];
  const items: MaterialLineItem[] = [];
  for (const rule of catalog.serviceMaterialRules) {
    if (rule.service_type_id !== service.typeId) continue;
    if (rule.match_field && service.values[rule.match_field] !== rule.match_value) continue;
    const material = catalog.materials.find((m) => m.id === rule.material_id);
    if (!material || !material.coverage_per_unit_sqft) continue;
    const rawUnits = areaSqFt / material.coverage_per_unit_sqft;
    const quantity = rawUnits * (1 + material.waste_factor_pct / 100);
    const totalCost = material.cost_per_unit != null ? quantity * material.cost_per_unit : null;
    items.push({
      zoneName: zone.name,
      materialId: material.id,
      material: material.name,
      unit: material.unit,
      quantity,
      totalCost,
    });
  }
  const ruleMaterialNames = new Set(items.map((item) => item.material));
  for (const name of service.materials ?? []) {
    if (ruleMaterialNames.has(name)) continue;
    const material = catalog.materials.find((m) => m.name === name);
    if (!material) continue;
    items.push({
      zoneName: zone.name,
      materialId: material.id,
      material: material.name,
      unit: material.unit,
      quantity: 1,
      totalCost: material.cost_per_unit,
      manual: true,
    });
  }
  return items;
}

export function formatMaterialQuantity(item: MaterialLineItem): string {
  if (item.manual) {
    return item.totalCost != null ? `As needed · $${item.totalCost.toFixed(2)}` : "As needed";
  }
  const qty = item.quantity < 10 ? item.quantity.toFixed(1) : Math.round(item.quantity).toLocaleString();
  let text = `${qty} ${item.unit}`;
  if (item.unit === "cubic yards") {
    const loads = Math.ceil((item.quantity * CUBIC_FEET_PER_YARD) / WHEELBARROW_CUBIC_FEET);
    text += ` (≈${loads} wheelbarrow loads)`;
  }
  if (item.totalCost != null) text += ` · $${item.totalCost.toFixed(2)}`;
  return text;
}

/** All material line items across every zone in the job, for a full material cost rollup. */
export function allMaterialLineItems(zones: WorkZone[], catalog: CanvasCatalog): MaterialLineItem[] {
  const items: MaterialLineItem[] = [];
  for (const zone of zones) {
    const measurements = zoneMeasurements(zone);
    items.push(...zoneMaterialLineItems(zone, measurements?.areaSqFt ?? 0, catalog));
  }
  return items;
}

/**
 * The one number a client sees: service cost + material cost across the
 * whole job. Materials with an unknown cost are excluded from the number
 * but flagged via `hasUnknownMaterialCost` so an admin knows it's a floor,
 * not the real total.
 */
export function computeProposalTotal(
  zones: WorkZone[],
  catalog: CanvasCatalog
): { total: number; hasNonFlatRate: boolean; hasUnknownMaterialCost: boolean } {
  const { totalCost, hasNonFlatRate } = computeJobTotals(zones, catalog);
  const materialItems = allMaterialLineItems(zones, catalog);
  let materialsCost = 0;
  let hasUnknownMaterialCost = false;
  for (const item of materialItems) {
    if (item.totalCost == null) {
      hasUnknownMaterialCost = true;
      continue;
    }
    materialsCost += item.totalCost;
  }
  return { total: totalCost + materialsCost, hasNonFlatRate, hasUnknownMaterialCost };
}
