import type { WorkZone } from "@/components/canvas/types";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import { buildEstimate, withTravelShare, type EstimateTravelInput, type JobEstimate } from "@/lib/job-estimate";
import { computeProposalTotal, formatMaterialQuantity, zoneCrewHours, zoneMaterialLineItems, zoneMeasurements } from "@/lib/proposal-pricing";
import { DEFAULT_SALT_SETTINGS } from "@/lib/salt";
import { combinedSaltingValues, isSalting, priceSaltingTogether, type SaltingVisits } from "@/lib/salting";

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

  // Every salting area at the house is sold as one: one visit, one price.
  // The first salting area carries it; the others are part of it and carry
  // nothing of their own, so the areas still add up to the total.
  const saltIndexes = zones.map((_, index) => index).filter((index) => isSalting(zones[index].service?.typeId));
  const together =
    saltIndexes.length > 0
      ? priceSaltingTogether([combinedSaltingValues(saltIndexes.map((index) => zones[index].service!.values))], salt, {
          toSiteMinutes: input.travel.toSiteMinutes,
          fromSiteMinutes: input.travel.fromSiteMinutes,
          crewCostPerHourCents: catalog.crewCostPerHourCents,
          feePct: input.feePct,
        })[0]
      : null;
  const salting: (SaltingVisits | null)[] = zones.map((_, index) => {
    const at = saltIndexes.indexOf(index);
    if (at < 0 || !together) return null;
    return at === 0 ? together : { ...together, billedHours: 0, labourCents: 0, materialCents: 0, perVisitCents: 0, totalCents: 0, onSiteMinutes: 0 };
  });
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
  if (salting.length > 0) {
    const s = salting[0];
    const treatments = Math.max(...salting.map((v) => v.treatments));
    const onSite = salting.reduce((sum, v) => sum + v.onSiteMinutes, 0);
    const hours = s.visitBilledHours ?? s.billedHours;
    labour.push({
      label: "Salting visits",
      detail: `${treatments} × ${hrs(hours)} hr${hours === 1 ? "" : "s"}: ${onSite} min on site${salting.length > 1 ? ` (${salting.length} areas)` : ""}, ${s.travelMinutes} min from the shop and back`,
      cents: salting.reduce((sum, v) => sum + v.labourCents * v.treatments, 0),
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
