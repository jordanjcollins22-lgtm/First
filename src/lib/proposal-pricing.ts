import type { WorkZone } from "@/components/canvas/types";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import { kindOfSaved } from "@/lib/zone-measurement";
import { priceJob, priceZone, type ZoneCost } from "@/lib/job-costing";

const CUBIC_FEET_PER_YARD = 27;
// Typical loaded wheelbarrow capacity used for hauling estimates.
const WHEELBARROW_CUBIC_FEET = 3;

export function zoneMeasurements(zone: WorkZone): { areaSqFt: number; perimeterFt: number } | null {
  if (zone.areaSqFt == null && zone.perimeterFt == null) return null;
  return { areaSqFt: zone.areaSqFt ?? 0, perimeterFt: zone.perimeterFt ?? 0 };
}

/** How many of the thing this zone covers, for count-priced services — the
 * "Quantity" field those service types already ask for. A zone exists
 * because there's at least one thing in it, so a blank counts as 1 rather
 * than making the service free. */
export function zoneServiceCount(zone: WorkZone): number {
  const raw = zone.service?.values?.quantity;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * The measurements as a line of text.
 *
 * A run measured length-only has no area, and printing "0 sq ft" beside its
 * length says something false about a zone somebody measured correctly. Pass
 * the zone so this can tell the two apart.
 */
export function formatMeasurements(
  m: { areaSqFt: number; perimeterFt: number },
  zone?: Pick<WorkZone, "measurementKind" | "lengthFt" | "widthFt" | "areaSqFt">
): string {
  if (zone && kindOfSaved(zone) === "linear") {
    return `${Math.round(m.perimeterFt).toLocaleString()} linear ft`;
  }
  return `${Math.round(m.areaSqFt).toLocaleString()} sq ft · ${Math.round(m.perimeterFt).toLocaleString()} ft perimeter`;
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

// ---------------------------------------------------------------------------
// Pricing from cost
//
// The business quotes materials plus labour, times two, plus ten percent
// overhead. Materials come off the service's material rules and the
// inventory's unit costs; labour comes off the service's timing and the
// measurement the evaluator took. Everything below gathers those two numbers
// for one zone and hands them to job-costing, which owns the arithmetic.
//
// This replaced a per-unit rate card, where a service carried the price of a
// square foot and the price was that times the area. The rate card is still
// in the table and is no longer read: a price worked out two ways is a price
// nobody can explain, and the business does not quote that way.
// ---------------------------------------------------------------------------

/** A zone's price, with what it is missing to be trusted. */
export interface ZonePricing extends ZoneCost {
  /**
   * A material on this zone has no unit cost recorded, so it contributed
   * nothing. The price is a floor, not the price.
   */
  hasUnknownMaterialCost: boolean;
  /**
   * The service has no timing, so no labour was charged. The zone is quoted
   * on its materials alone, which for most work is nearly nothing.
   */
  hasMissingTiming: boolean;
}

/**
 * How long this zone takes a crew, from the service's timing and the
 * measurement taken.
 *
 * Crew-hours rather than clock-hours: three people for an hour is three, and
 * three is what gets paid for.
 *
 * A service priced flat has no measurement to multiply, so its timing has to
 * be the whole-job estimate rather than a rate. Saying so is the point of the
 * second return value -- charging nothing for labour and staying quiet is how
 * a job gets quoted at the cost of its mulch.
 */
export function zoneCrewHours(
  zone: WorkZone,
  catalog: CanvasCatalog
): { hours: number; missingTiming: boolean } {
  const service = zone.service;
  if (!service) return { hours: 0, missingTiming: false };

  const pricing = catalog.servicePricing.find((p) => p.service_type_id === service.typeId);
  if (!pricing || pricing.status !== "active") return { hours: 0, missingTiming: false };

  const measurements = zoneMeasurements(zone);
  const units =
    pricing.pricing_basis === "area"
      ? measurements?.areaSqFt ?? 0
      : pricing.pricing_basis === "perimeter"
        ? measurements?.perimeterFt ?? 0
        : pricing.pricing_basis === "count"
          ? zoneServiceCount(zone)
          : null;

  if (units != null && pricing.minutes_per_sqft != null) {
    return {
      hours: (pricing.minutes_per_sqft / 60) * units * (pricing.crew_size ?? 1),
      missingTiming: false,
    };
  }
  // Already a whole-job figure, so the crew size is baked into it.
  if (pricing.estimated_hours != null) {
    return { hours: pricing.estimated_hours, missingTiming: false };
  }
  return { hours: 0, missingTiming: true };
}

/** What this zone's materials cost us, in whole cents. */
export function zoneMaterialsCents(
  zone: WorkZone,
  catalog: CanvasCatalog
): { cents: number; hasUnknownCost: boolean } {
  const measurements = zoneMeasurements(zone);
  const items = zoneMaterialLineItems(zone, measurements?.areaSqFt ?? 0, catalog);

  let cents = 0;
  let hasUnknownCost = false;
  for (const item of items) {
    if (item.totalCost == null) {
      hasUnknownCost = true;
      continue;
    }
    cents += item.totalCost * 100;
  }
  return { cents: Math.round(cents), hasUnknownCost };
}

/** Cost and price for one work area. */
export function costZone(zone: WorkZone, catalog: CanvasCatalog): ZonePricing {
  const materials = zoneMaterialsCents(zone, catalog);
  const time = zoneCrewHours(zone, catalog);

  return {
    ...priceZone(
      {
        materialsCents: materials.cents,
        crewHours: time.hours,
        crewCostPerHourCents: catalog.crewCostPerHourCents,
      },
      catalog.markup
    ),
    hasUnknownMaterialCost: materials.hasUnknownCost,
    hasMissingTiming: time.missingTiming,
  };
}

/**
 * Cost and price for the whole job, summed from its zones.
 *
 * Zones with no service are skipped rather than priced at nothing: an
 * undecided shape is a drafting artefact, not free work.
 */
export function costJob(zones: WorkZone[], catalog: CanvasCatalog): ZonePricing {
  const priced = zones.filter((zone) => zone.service).map((zone) => costZone(zone, catalog));
  return {
    ...priceJob(priced),
    hasUnknownMaterialCost: priced.some((zone) => zone.hasUnknownMaterialCost),
    hasMissingTiming: priced.some((zone) => zone.hasMissingTiming),
  };
}

/**
 * The one number a client sees, in dollars.
 *
 * Kept as a wrapper over costJob so the callers that only want the total do
 * not have to know how it was reached. `hasMissingTiming` and
 * `hasUnknownMaterialCost` are what makes a price a floor rather than a
 * price, and a caller showing the number to somebody who can change it should
 * say so.
 */
export function computeProposalTotal(
  zones: WorkZone[],
  catalog: CanvasCatalog
): { total: number; hasMissingTiming: boolean; hasUnknownMaterialCost: boolean } {
  const job = costJob(zones, catalog);
  return {
    total: job.priceCents / 100,
    hasMissingTiming: job.hasMissingTiming,
    hasUnknownMaterialCost: job.hasUnknownMaterialCost,
  };
}
