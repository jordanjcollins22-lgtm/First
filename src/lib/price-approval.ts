/**
 * The account manager's look at a submitted walkthrough before a client
 * sees a price: every area on the site map with what it costs to do and
 * what it is priced at, and the job's totals (budgeted crew-hours, labour,
 * materials, markup). Then Accept the price, or Decline it and type the
 * price it should be.
 *
 * A typed price is spread across the areas in proportion to what each was
 * priced at, so the areas on the proposal still add up to the total a
 * client is shown, and each is marked as set by hand rather than off the
 * rate card.
 *
 * Pure, so the arithmetic is tested without a database.
 */

import type { WorkZone } from "@/components/canvas/types";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import { costZone, formatMaterialQuantity, zoneCrewHours, zoneMaterialLineItems, zoneMeasurements } from "@/lib/proposal-pricing";
import type { ProposalZoneSnapshot } from "@/types/domain";
import { isSalting, saltingOrder } from "@/lib/salting";

export interface AreaCost {
  name: string;
  service: string;
  /** The measurement it is priced on, in words. */
  size: string | null;
  crewHours: number;
  labourCents: number;
  materials: { name: string; amount: string; cents: number | null }[];
  materialsCents: number;
  /** Markup and overhead on top of labour and materials. */
  markupCents: number;
  priceCents: number;
  /** The service has no timing on the rate card, so no labour was counted. */
  missingTiming: boolean;
  /** A material has no cost in the inventory, so it counted as nothing. */
  unknownMaterialCost: boolean;
  /** The photos taken of it on the walkthrough, as storage paths. */
  photoPaths: string[];
}

export interface PriceBreakdown {
  areas: AreaCost[];
  crewHours: number;
  labourCents: number;
  materialsCents: number;
  markupCents: number;
  priceCents: number;
  /** Each material for the whole job: how much, and what it costs. */
  materialTotals: { name: string; amount: string; cents: number | null }[];
  /** Anything that makes the worked-out price a floor rather than a price. */
  warnings: string[];
}

type Catalog = Pick<CanvasCatalog, "servicePricing" | "serviceMaterialRules" | "materials" | "crewCostPerHourCents" | "markup" | "salt">;

export function priceBreakdown(zones: WorkZone[], catalog: Catalog): PriceBreakdown {
  const nameOf = new Map(catalog.servicePricing.map((p) => [p.service_type_id, p.name]));
  const areas = zones
    .filter((zone) => zone.service)
    .map((zone): AreaCost => {
      const cost = costZone(zone, catalog as CanvasCatalog);
      const m = zoneMeasurements(zone);
      const items = zoneMaterialLineItems(zone, m?.areaSqFt ?? 0, catalog as CanvasCatalog);
      return {
        name: zone.name,
        service: nameOf.get(zone.service!.typeId) ?? zone.service!.typeId,
        size: isSalting(zone.service!.typeId)
          ? (() => {
              const order = saltingOrder(zone.service!.values);
              return `${order.treatments} treatments · ${order.surfaceLabel}${order.petFriendly ? " · pet safe" : ""}`;
            })()
          : m && m.areaSqFt > 0
            ? `${Math.round(m.areaSqFt).toLocaleString("en-US")} sq ft`
            : m && m.perimeterFt > 0
              ? `${Math.round(m.perimeterFt).toLocaleString("en-US")} ft`
              : null,
        crewHours: zoneCrewHours(zone, catalog as CanvasCatalog).hours,
        labourCents: cost.labourCents,
        materials: items.map((item) => ({
          name: item.material,
          amount: formatMaterialQuantity({ ...item, totalCost: null }),
          cents: item.totalCost != null ? Math.round(item.totalCost * 100) : null,
        })),
        materialsCents: cost.materialsCents,
        markupCents: cost.priceCents - cost.directCostCents,
        priceCents: cost.priceCents,
        missingTiming: cost.hasMissingTiming,
        unknownMaterialCost: cost.hasUnknownMaterialCost,
        photoPaths: zone.service!.photos ?? [],
      };
    });
  const sum = (pick: (a: AreaCost) => number) => areas.reduce((total, a) => total + pick(a), 0);
  // The same material across areas, added up: 8 yards of mulch, not four
  // lines of two.
  const totals = new Map<string, { name: string; unit: string; quantity: number; cents: number | null }>();
  for (const zone of zones.filter((z) => z.service)) {
    const m = zoneMeasurements(zone);
    for (const item of zoneMaterialLineItems(zone, m?.areaSqFt ?? 0, catalog as CanvasCatalog)) {
      if (item.manual) continue;
      const key = `${item.material}|${item.unit}`;
      const t = totals.get(key) ?? { name: item.material, unit: item.unit, quantity: 0, cents: 0 };
      t.quantity += item.quantity;
      t.cents = t.cents == null || item.totalCost == null ? null : t.cents + Math.round(item.totalCost * 100);
      totals.set(key, t);
    }
  }
  const materialTotals = [...totals.values()].map((t) => ({
    name: t.name,
    amount: `${t.quantity < 10 ? t.quantity.toFixed(1) : Math.round(t.quantity).toLocaleString("en-US")} ${t.unit}`,
    cents: t.cents,
  }));
  const warnings: string[] = [];
  const untimed = areas.filter((a) => a.missingTiming).map((a) => a.service);
  if (untimed.length) warnings.push(`No crew time on the rate card for ${[...new Set(untimed)].join(", ")}, so no labour is counted there.`);
  if (areas.some((a) => a.unknownMaterialCost)) warnings.push("A material has no cost in the inventory, so it is counted as nothing.");
  if (areas.some((a) => !a.size)) warnings.push("An area has no measurement.");
  return {
    areas,
    crewHours: sum((a) => a.crewHours),
    labourCents: sum((a) => a.labourCents),
    materialsCents: sum((a) => a.materialsCents),
    markupCents: sum((a) => a.markupCents),
    priceCents: sum((a) => a.priceCents),
    materialTotals,
    warnings,
  };
}

/**
 * The proposal's areas re-priced to a total typed in by hand: each keeps its
 * share of what they were priced at (an even share when none had a price),
 * rounded to the cent, with the last taking the rounding so the areas add
 * up to the total exactly. Each is marked as set by hand.
 */
export function spreadPrice(snapshot: ProposalZoneSnapshot[], totalDollars: number): ProposalZoneSnapshot[] {
  if (snapshot.length === 0) return snapshot;
  const totalCents = Math.round(totalDollars * 100);
  const before = snapshot.map((z) => Math.max(0, z.priceCents ?? 0));
  const beforeTotal = before.reduce((a, b) => a + b, 0);
  const shares = beforeTotal > 0 ? before.map((c) => c / beforeTotal) : snapshot.map(() => 1 / snapshot.length);
  let given = 0;
  return snapshot.map((zone, i) => {
    const cents = i === snapshot.length - 1 ? totalCents - given : Math.round(totalCents * shares[i]);
    given += cents;
    return { ...zone, priceCents: cents, priceDerived: false };
  });
}

/** Reads a typed price: dollars, commas and a $ allowed. Null when it is not a price. */
export function readPrice(text: string): number | null {
  const n = Number(text.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}
