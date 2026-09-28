/**
 * The estimate behind a proposal, on one screen: how long each area takes,
 * who it takes, how long everybody spends in the truck, what gets bought,
 * and what all of that costs and is priced at.
 *
 * Built when the site map is turned into a proposal, and kept with it, so
 * the number somebody says yes or no to is the number that went out, and the
 * workings beside it are the ones that made it.
 *
 * Travel is part of the price. A morning out of the shop and a drive back at
 * night, every day the job runs, with the whole crew in the truck and paid;
 * plus one trip to pick up the materials when there are any. Priced with the
 * same markup as the work, and spread across the areas by their share of the
 * price, so the areas still add up to the total the client sees.
 *
 * Charged in whole hours: the crew's time on the clock -- on site and in
 * the truck -- is rounded up to the hour, an hour at the least. And never
 * under half the price as gross profit once labour, materials and the
 * account manager's or affiliate's share are paid: a rate card that comes
 * out under that is lifted to it.
 *
 * Pure: the drive times come in as numbers, worked out elsewhere.
 */

import { priceZone, type Markup } from "@/lib/job-costing";
import { billedHours, priceForTarget } from "@/lib/gross-profit";

/** Hours in a working day on site, for turning hours into days. */
export const WORKDAY_HOURS = 8;

export interface EstimateZoneInput {
  name: string;
  service: string;
  /** "240 sq ft", "60 linear ft": what was measured. */
  sizeLabel: string | null;
  /** Crew-hours, as the service's timing gives them. */
  crewHours: number;
  /** How many people the service takes. */
  crewSize: number;
  /** The service has no timing, so no hours could be worked out. */
  missingTiming: boolean;
  materials: { name: string; quantityLabel: string; costCents: number | null }[];
  /** The area's own price before travel, as the rate card gives it. */
  priceCents: number;
}

export interface EstimateTravelInput {
  /** Shop to the property, in minutes. Null when it could not be worked out. */
  toSiteMinutes: number | null;
  /** The property back to the shop. */
  fromSiteMinutes: number | null;
  /** What going by the supplier adds to the morning drive, in minutes. */
  pickupExtraMinutes: number | null;
  from: string | null;
  pickupFrom: string | null;
  /** Anything that had to be assumed, in words. */
  notes: string[];
}

export interface EstimateZone {
  name: string;
  service: string;
  sizeLabel: string | null;
  /** How long it takes on the clock, with its crew. */
  hours: number;
  crewSize: number;
  crewHours: number;
  missingTiming: boolean;
}

export interface EstimateMaterial {
  name: string;
  quantityLabel: string;
  zone: string;
  costCents: number | null;
}

export interface JobEstimate {
  zones: EstimateZone[];
  /** The most people any area needs: the crew that goes out. */
  crew: number;
  /** On the clock, on site, with that crew. */
  onSiteHours: number;
  days: number;
  travel: {
    /** Each way, per day, in minutes. */
    toSiteMinutes: number;
    fromSiteMinutes: number;
    /** Once, for the materials. Zero when nothing is being bought. */
    pickupMinutes: number;
    /** Everybody in the truck, every day, in crew-hours. */
    crewHours: number;
    from: string | null;
    pickupFrom: string | null;
    notes: string[];
  };
  materials: EstimateMaterial[];
  crewCostPerHourCents: number;
  /** On the clock, on site and in the truck, rounded up to whole hours: what is charged. */
  billedHours: number;
  /** Crew-hours added by rounding up to the hour. */
  roundingCrewHours: number;
  costs: {
    onSiteLabourCents: number;
    travelLabourCents: number;
    /** The part of an hour rounded up to the whole hour, at the crew rate. */
    roundingLabourCents?: number;
    materialsCents: number;
    /** What it all costs us, before the fee. */
    directCents: number;
  };
  /** The areas' prices before travel, and what travel adds, marked up the same way. */
  workPriceCents: number;
  travelPriceCents: number;
  /** What rounding up to whole hours adds, marked up the same way. */
  roundingPriceCents?: number;
  /** What was added to reach the gross profit floor. Zero when the rate card was already over it. */
  floorLiftCents?: number;
  /** The account manager's or affiliate's share, in percent, and in cents of the price. */
  feePct?: number;
  feeCents?: number;
  /** What the price leaves after labour, materials and the fee. */
  grossCents?: number;
  grossPct?: number;
  /** The number: what the client is quoted. */
  priceCents: number;
  /** Things that make the number less than certain, in words. */
  warnings: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildEstimate(input: {
  zones: EstimateZoneInput[];
  travel: EstimateTravelInput;
  crewCostPerHourCents: number;
  markup: Markup;
  /** The account manager's or affiliate's share of the price, in percent. */
  feePct?: number;
  /** Assumed when the drive could not be worked out. */
  fallbackDriveMinutes?: number;
  fallbackPickupMinutes?: number;
}): JobEstimate {
  const fallbackDrive = input.fallbackDriveMinutes ?? 30;
  const fallbackPickup = input.fallbackPickupMinutes ?? 30;
  const zones: EstimateZone[] = input.zones.map((z) => {
    const crewSize = Math.max(1, Math.round(z.crewSize || 1));
    return {
      name: z.name,
      service: z.service,
      sizeLabel: z.sizeLabel,
      hours: round1(z.crewHours / crewSize),
      crewSize,
      crewHours: round1(z.crewHours),
      missingTiming: z.missingTiming,
    };
  });

  const crew = Math.max(1, ...zones.map((z) => z.crewSize));
  const totalCrewHours = input.zones.reduce((s, z) => s + Math.max(0, z.crewHours), 0);
  const onSiteHours = round1(totalCrewHours / crew);
  const days = Math.max(1, Math.ceil(onSiteHours / WORKDAY_HOURS));

  const materials: EstimateMaterial[] = input.zones.flatMap((z) =>
    z.materials.map((m) => ({ name: m.name, quantityLabel: m.quantityLabel, zone: z.name, costCents: m.costCents }))
  );
  const buying = materials.length > 0;

  const notes = [...input.travel.notes];
  const toSite = input.travel.toSiteMinutes ?? fallbackDrive;
  const fromSite = input.travel.fromSiteMinutes ?? input.travel.toSiteMinutes ?? fallbackDrive;
  if (input.travel.toSiteMinutes == null) notes.push(`Drive time assumed at ${fallbackDrive} minutes each way.`);
  let pickup = 0;
  if (buying) {
    pickup = input.travel.pickupExtraMinutes ?? fallbackPickup;
    if (input.travel.pickupExtraMinutes == null) notes.push(`Material pickup assumed at ${fallbackPickup} minutes.`);
  }
  // Nothing to go out for: no drive, no hours.
  const working = input.zones.length > 0;
  const travelExact = working ? (days * (toSite + fromSite) * crew + pickup * crew) / 60 : 0;
  const travelCrewHours = round1(travelExact);
  // The clock runs from leaving the shop to getting back, and is charged in
  // whole hours: what that adds is its own line, so the hours add up.
  const clock = working ? billedHours(totalCrewHours / crew + travelExact / crew) : 0;
  const roundingExact = Math.max(0, clock * crew - totalCrewHours - travelExact);
  const roundingCrewHours = Math.round(roundingExact * 100) / 100;

  const rate = Math.max(0, input.crewCostPerHourCents);
  const onSiteLabourCents = Math.round(totalCrewHours * rate);
  const travelLabourCents = Math.round(travelExact * rate);
  const roundingLabourCents = Math.round(roundingExact * rate);
  const materialsCents = materials.reduce((s, m) => s + (m.costCents ?? 0), 0);

  const workPriceCents = input.zones.reduce((s, z) => s + Math.max(0, z.priceCents), 0);
  // Travel is labour: priced as a crew's hours with no materials, so a per
  // crew-hour overhead is charged on it the same as on the work. So is the
  // rest of the last hour.
  const travelPriceCents = working ? priceZone({ materialsCents: 0, crewHours: travelExact, crewCostPerHourCents: rate }, input.markup).priceCents : 0;
  const roundingPriceCents =
    roundingExact > 0 ? priceZone({ materialsCents: 0, crewHours: roundingExact, crewCostPerHourCents: rate }, input.markup).priceCents : 0;

  // Never under the gross profit floor, after the fee.
  const feePct = Math.max(0, input.feePct ?? 0);
  const labourCents = onSiteLabourCents + travelLabourCents + roundingLabourCents;
  const ratePrice = workPriceCents + travelPriceCents + roundingPriceCents;
  const floor = working ? priceForTarget(labourCents, materialsCents, feePct) : null;
  const priceCents = Math.max(ratePrice, floor ?? 0);
  const feeCents = Math.round((priceCents * feePct) / 100);
  const grossCents = priceCents - labourCents - materialsCents - feeCents;

  const warnings: string[] = [];
  if (rate === 0) warnings.push("No crew rate is set, so labour and travel are priced at nothing. Set it on the Team page.");
  const untimed = zones.filter((z) => z.missingTiming).map((z) => z.name);
  if (untimed.length) warnings.push(`No timing on the service for ${untimed.join(", ")}, so those hours are missing.`);
  const unpriced = materials.filter((m) => m.costCents == null).map((m) => m.name);
  if (unpriced.length) warnings.push(`No cost recorded for ${[...new Set(unpriced)].join(", ")}.`);

  return {
    zones,
    crew,
    onSiteHours,
    days,
    travel: {
      toSiteMinutes: Math.round(toSite),
      fromSiteMinutes: Math.round(fromSite),
      pickupMinutes: Math.round(pickup),
      crewHours: travelCrewHours,
      from: input.travel.from,
      pickupFrom: buying ? input.travel.pickupFrom : null,
      notes,
    },
    materials,
    crewCostPerHourCents: rate,
    billedHours: clock,
    roundingCrewHours,
    costs: {
      onSiteLabourCents,
      travelLabourCents,
      roundingLabourCents,
      materialsCents,
      directCents: labourCents + materialsCents,
    },
    workPriceCents,
    travelPriceCents,
    roundingPriceCents,
    floorLiftCents: priceCents - ratePrice,
    feePct,
    feeCents,
    grossCents,
    grossPct: priceCents > 0 ? grossCents / priceCents : 0,
    priceCents,
    warnings,
  };
}

/**
 * Each area's price with its share of the travel, so the areas still add up
 * to the total. Shared by each area's own price; the last one takes whatever
 * the rounding left, so the sum is exact.
 */
export function withTravelShare(areaPricesCents: number[], travelPriceCents: number): number[] {
  const total = areaPricesCents.reduce((s, p) => s + Math.max(0, p), 0);
  if (areaPricesCents.length === 0) return [];
  let given = 0;
  return areaPricesCents.map((price, i) => {
    if (i === areaPricesCents.length - 1) return price + (travelPriceCents - given);
    const share = total > 0 ? Math.round((travelPriceCents * Math.max(0, price)) / total) : Math.round(travelPriceCents / areaPricesCents.length);
    given += share;
    return price + share;
  });
}
