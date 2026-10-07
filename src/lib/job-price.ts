import type { WorkZone } from "@/components/canvas/types";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import { buildEstimate, withTravelShare, type EstimateTravelInput, type JobEstimate } from "@/lib/job-estimate";
import { computeProposalTotal, formatMaterialQuantity, zoneCrewHours, zoneMaterialLineItems, zoneMeasurements } from "@/lib/proposal-pricing";
import { DEFAULT_SALT_SETTINGS } from "@/lib/salt";
import { isSalting, priceSaltingVisitsTogether, type SaltingVisits } from "@/lib/salting";

/**
 * A whole site map priced the one way, for the proposal the client gets and
 * for the account manager's look at it before it goes.
 *
 * The work is priced by the rate card, then the estimate around it: the
 * crew's time on site and in the truck (shop, supplier when there are
 * materials, the house, back to the shop, every day), charged in whole hours,
 * and lifted to half the price as gross profit after the account manager's
 * or affiliate's share when the rate card comes out under that. Salting is
 * priced a visit at a time by the same rules. Every area carries its share,
 * so the areas add up to the total.
 *
 * Pure: the drive times and the fee come in, worked out elsewhere.
 */

export interface SiteMapPrice {
  estimate: JobEstimate;
  /** Per zone: the salting's visits, or null for work that is not salting. */
  salting: (SaltingVisits | null)[];
  /** Per zone: its price with its share of travel, rounding and any lift, in cents. */
  areaPricesCents: number[];
  /** Per zone: the rate card's own price, before any of that. */
  ownCents: number[];
  totalCents: number;
  /** A service with no timing, or a material with no cost, somewhere in it. */
  hasMissingTiming: boolean[];
  hasUnknownMaterialCost: boolean[];
}

export function priceSiteMap(input: {
  zones: WorkZone[];
  catalog: CanvasCatalog;
  travel: EstimateTravelInput;
  feePct: number;
  /** What to call each area's service and size, for the estimate. */
  labelFor?: (zone: WorkZone, index: number) => { service: string; sizeLabel: string | null };
}): SiteMapPrice {
  const { zones, catalog } = input;
  const pricingBy = new Map(catalog.servicePricing.map((p) => [p.service_type_id, p]));
  const own = zones.map((zone) => computeProposalTotal([zone], catalog));
  const ownCents = own.map((o) => Math.round(o.total * 100));
  const salt = catalog.salt ?? DEFAULT_SALT_SETTINGS;

  // One trip a visit for all of a property's salting, however many areas it is drawn as.
  const salting = priceSaltingVisitsTogether(
    zones.map((zone) => (isSalting(zone.service?.typeId) ? zone.service!.values : null)),
    salt,
    {
      toSiteMinutes: input.travel.toSiteMinutes,
      fromSiteMinutes: input.travel.fromSiteMinutes,
      crewCostPerHourCents: catalog.crewCostPerHourCents,
      feePct: input.feePct,
    }
  );
  const workIndexes = zones.map((_, index) => index).filter((index) => !salting[index]);

  const estimate = buildEstimate({
    zones: workIndexes.map((index) => {
      const zone = zones[index];
      const pricingRow = zone.service ? pricingBy.get(zone.service.typeId) : undefined;
      const time = zoneCrewHours(zone, catalog);
      const measured = zoneMeasurements(zone);
      const label = input.labelFor?.(zone, index) ?? { service: pricingRow?.name ?? zone.service?.typeId ?? "Service", sizeLabel: null };
      return {
        name: zone.name,
        service: label.service,
        sizeLabel: label.sizeLabel,
        crewHours: time.hours,
        crewSize: pricingRow?.crew_size ?? 1,
        missingTiming: time.missingTiming,
        materials: zoneMaterialLineItems(zone, measured?.areaSqFt ?? 0, catalog).map((item) => ({
          name: item.material,
          quantityLabel: formatMaterialQuantity(item),
          costCents: item.totalCost == null ? null : Math.round(item.totalCost * 100),
        })),
        priceCents: ownCents[index],
      };
    }),
    travel: input.travel,
    crewCostPerHourCents: catalog.crewCostPerHourCents,
    markup: catalog.markup,
    feePct: input.feePct,
  });

  // Travel, the rest of the last hour and any lift to the floor, shared
  // across the work by each area's share of it.
  const shares = withTravelShare(
    workIndexes.map((index) => ownCents[index]),
    estimate.priceCents - estimate.workPriceCents
  );
  const areaPricesCents = zones.map((_, index) => salting[index]?.totalCents ?? shares[workIndexes.indexOf(index)]);
  return {
    estimate,
    salting,
    areaPricesCents,
    ownCents,
    totalCents: areaPricesCents.reduce((sum, cents) => sum + cents, 0),
    hasMissingTiming: own.map((o) => o.hasMissingTiming),
    hasUnknownMaterialCost: own.map((o) => o.hasUnknownMaterialCost),
  };
}

/** One line of what a job costs us, in words, for the account manager. */
export interface CostLine {
  label: string;
  detail: string;
  cents: number;
}

/** What a priced site map costs, line by line, and the price it works out at. */
export interface JobCosts {
  /** What the site map works out at, travel, whole hours and the floor in. */
  workedCents: number;
  /** Visits, when the whole job is salting at the same number of treatments; null otherwise. */
  visits: number | null;
  /** Labour, line by line: on site, the drive, the rest of the last hour, salting visits. */
  labour: CostLine[];
  labourCents: number;
  materialsCents: number;
  /** Each area's price with its share of travel, whole hours and the floor, in the order of the site map. */
  areaPricesCents: number[];
}

const hrs = (h: number) => (Math.abs(h - Math.round(h)) < 0.05 ? String(Math.round(h)) : h.toFixed(1));

export function jobCosts(priced: SiteMapPrice): JobCosts {
  const e = priced.estimate;
  const labour: CostLine[] = [];
  if (e.zones.length > 0) {
    const onSiteCrewHours = e.zones.reduce((sum, z) => sum + z.crewHours, 0);
    labour.push({
      label: "Labour on site",
      detail: `${hrs(onSiteCrewHours)} crew-hrs${e.crew > 1 ? `, ${e.crew} people` : ""}`,
      cents: e.costs.onSiteLabourCents,
    });
    const stops = [e.travel.from ?? "Shop", e.travel.pickupFrom, "the house", "back"].filter(Boolean).join(" → ");
    const legs = [e.travel.toSiteMinutes, e.travel.pickupMinutes || null, e.travel.fromSiteMinutes].filter((m) => m != null).join(" + ");
    labour.push({
      label: "Travel",
      detail: `${stops}: ${legs} min${e.days > 1 ? ` a day, ${e.days} days` : ""}${e.crew > 1 ? `, ${e.crew} people` : ""}`,
      cents: e.costs.travelLabourCents,
    });
    if ((e.costs.roundingLabourCents ?? 0) > 0) {
      labour.push({
        label: "Rounded up to the hour",
        detail: `${e.billedHours} hr${e.billedHours === 1 ? "" : "s"} on the clock${e.crew > 1 ? ` × ${e.crew} people` : ""}`,
        cents: e.costs.roundingLabourCents ?? 0,
      });
    }
  }
  const salting = priced.salting.filter((s): s is SaltingVisits => s != null);
  // Areas sharing a trip are one line: the visit, not each area's share of it.
  const shown = new Set<object>();
  for (const s of salting) {
    if (s.visit) {
      if (shown.has(s.visit)) continue;
      shown.add(s.visit);
      const v = s.visit;
      labour.push({
        label: "Salting visits",
        detail: `${s.treatments} × ${v.billedHours} hr${v.billedHours === 1 ? "" : "s"}: ${v.onSiteMinutes} min on site across ${v.areas} areas, ${v.travelMinutes} min from the shop and back`,
        cents: v.labourCents * s.treatments,
      });
      continue;
    }
    labour.push({
      label: "Salting visits",
      detail: `${s.treatments} × ${s.billedHours} hr${s.billedHours === 1 ? "" : "s"}: ${s.onSiteMinutes} min on site, ${s.travelMinutes} min from the shop and back`,
      cents: s.labourCents * s.treatments,
    });
  }
  const saltMaterials = salting.reduce((sum, s) => sum + s.materialCents * s.treatments, 0);
  const onlySalting = e.zones.length === 0 && salting.length > 0 && salting.every((s) => s.treatments === salting[0].treatments);
  return {
    workedCents: priced.totalCents,
    visits: onlySalting ? salting[0].treatments : null,
    labour,
    labourCents: labour.reduce((sum, l) => sum + l.cents, 0),
    materialsCents: e.costs.materialsCents + saltMaterials,
    areaPricesCents: priced.areaPricesCents,
  };
}
