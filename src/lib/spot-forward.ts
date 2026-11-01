/**
 * The client's estimate, priced by the same calculator as a proposal.
 *
 * The map works out each spot's size and what is to be done there; this
 * turns that work into the production-rate services a proposal is priced
 * from (yards of mulch spread, square feet weeded, bushes trimmed) and
 * prices them the forward way:
 *
 *   labour     each service's quantity ÷ its production rate, in crew-hours,
 *              at the crew's hourly cost, plus the paid time off the work
 *              (the drive, loading, the dump) that the job carries;
 *   materials  bulk mulch, rock and topsoil from the closest supplier's price
 *              list, delivery included, else the service's own material cost;
 *   price      (materials + labour) ÷ the project cost margin, which keeps the
 *              gross profit and the commissions the pricing equation sets.
 *
 * So the estimate and the proposal after the visit come from one set of
 * numbers, and a change on the production rates page moves both.
 *
 * Pure, so it is tested without a database.
 */

import { priceFromSuppliers } from "@/lib/forward-materials";
import {
  crewRateCents,
  materialCentsFor,
  priceForward,
  productionService,
  projectCostMargin,
  type PriceLine,
  type PricingEquation,
  type ProductionService,
} from "@/lib/forward-pricing";
import type { InstantLine, InstantMaterial, InstantWork } from "@/lib/instant-price";
import type { Supplier } from "@/lib/material-suppliers";

export interface ForwardSetup {
  equation: PricingEquation;
  services: ProductionService[];
  /** The business's bulk suppliers, for mulch, rock and topsoil. */
  suppliers: Supplier[];
  /** Where the job is, for the closest supplier and its delivery fee. */
  site: { lat: number; lng: number; zip: string | null } | null;
  /** The drive from the shop and back, in minutes; null when it couldn't be worked out. */
  driveMinutesPerDay: number | null;
}

/** Mulch and rock are spread two inches deep, as a proposal prices them. */
const SPREAD_INCHES = 2;

/** Yards for an area at a depth, to the next half yard, as a proposal orders them. */
function yardsFor(sqft: number, inches: number): number {
  return Math.ceil(((sqft * (inches / 12)) / 27) * 2) / 2;
}

/**
 * The production-rate services one piece of a spot's work is, with how much
 * of each. Empty for work with no service (a patio, "take a look"), which is
 * priced at the visit.
 */
export function forwardLinesFor(work: InstantWork, services: ProductionService[]): PriceLine[] {
  const area = Math.max(0, work.areaSqft ?? 0);
  const count = Math.max(0, work.count ?? 0);
  // Weeds under a new bed take half as long; a two-storey wash takes longer.
  const factor = work.hoursFactor && work.hoursFactor > 0 ? work.hoursFactor : 1;
  const line = (key: string, quantity: number, note: string): PriceLine => ({ key, quantity, materialCents: 0, note });
  const sq = (n: number) => `${Math.round(n).toLocaleString("en-US")} sq ft`;

  let lines: PriceLine[] = [];
  switch (work.typeId) {
    case "landscape-bed": {
      if (!(area > 0)) break;
      const rock = /rock/i.test(work.values?.material ?? "");
      lines = [line(rock ? "rock-install" : "mulch-install", yardsFor(area, SPREAD_INCHES), `${sq(area)} at ${SPREAD_INCHES} inches deep`)];
      break;
    }
    case "landscape-cleanup":
      if (area > 0) lines = [line("weed-pulling", area * factor, factor === 1 ? sq(area) : `${sq(area)}, half the time under a new bed`)];
      break;
    case "lawn-restoration":
      if (area > 0) lines = [line("soil-prep", area, sq(area)), line("seeding", area, sq(area))];
      break;
    case "grading":
      if (area > 0) lines = [line("hand-grading", area, sq(area))];
      break;
    case "soft-washing":
      if (area > 0) lines = [line("soft-washing", area * factor, factor === 1 ? `${sq(area)} of siding` : `${sq(area)} of siding, × ${factor} for the height`)];
      break;
    case "trimming":
      if (count > 0) lines = [line("shrub-trimming", count, `${count} ${count === 1 ? "bush" : "bushes"}`)];
      break;
    case "plant-bush-removal":
      if (count > 0) lines = [line("plant-removal-medium", count, `${count} ${count === 1 ? "bush" : "bushes"}, priced as medium`)];
      break;
    case "plant-installation":
      // Labour only: the plants themselves are picked and priced on the visit.
      if (count > 0) return [line("plant-install-1gal", count, `${count} plants, planting only`)];
      break;
  }
  // Each service's own material cost, as a proposal starts from; bulk
  // material is then repriced from the suppliers.
  return lines.flatMap((l) => {
    const service = productionService(l.key, services);
    if (!service || service.active === false) return [];
    return [service.materialCentsPerUnit ? { ...l, materialCents: materialCentsFor(service, l.quantity) } : l];
  });
}

function amount(q: number): string {
  return q < 10 ? String(+q.toFixed(2)) : Math.round(q).toLocaleString("en-US");
}

/**
 * Each piece of work priced the forward way, as the estimate's lines, in the
 * same order. A piece with no production-rate service comes back null, for
 * the caller to price as it always has (on the visit, mostly).
 */
export function priceWorksForward(works: InstantWork[], setup: ForwardSetup): (InstantLine | null)[] {
  const { equation, services } = setup;
  const built = works.map((w) => forwardLinesFor(w, services));
  const supplied = priceFromSuppliers(built, services, setup.suppliers, setup.site).lines;
  const job = priceForward(supplied, equation, services, setup.driveMinutesPerDay);
  const pcm = projectCostMargin(equation);

  return works.map((w, i) => {
    const area = job.areas[i];
    if (supplied[i].length === 0 || !(area.rCents > 0)) return null;
    const materials: InstantMaterial[] = area.lines
      .filter((l) => l.materialCents > 0)
      .map((l) => {
        const service = productionService(l.key, services);
        return {
          name: service?.materialName ?? l.label,
          amount: `${amount(l.quantity)} ${l.unit === "CY" ? "cubic yards" : l.unit}`,
          cents: l.materialCents,
          // A supplier's price is the real one; the service's own cost is the stand-in.
          typical: !l.supplied,
        };
      });
    const rate = area.lines
      .filter((l) => l.pr)
      .map((l) => `${amount(l.quantity)} ${l.unit} at ${l.pr} ${l.unit} a crew-hour (${l.label.toLowerCase()})`)
      .join("; ");
    const offWork = area.offWork.plh > 0 ? `; plus ${+area.offWork.plh.toFixed(2)} crew-hours of drive and time off the work` : "";
    const size = w.count != null ? `${w.count} ${w.countOf ?? "items"}` : w.areaSqft != null ? `${Math.round(w.areaSqft).toLocaleString("en-US")} sq ft` : null;
    return {
      service: w.service,
      label: w.label,
      priceAs: area.lines[0]?.label ?? null,
      size,
      sizeFrom: w.sizeFrom ?? null,
      crewHours: +area.plh.toFixed(2),
      rate: `${rate}${offWork}, at $${(crewRateCents(equation) / 100).toFixed(2)} a crew-hour`,
      rateTypical: false,
      labourCents: Math.round(area.plcCents),
      materials,
      materialsCents: area.materialCents,
      markupCents: area.rCents - Math.round(area.costCents),
      priceCents: area.rCents,
      note: w.note ?? (pcm <= 0 ? "The pricing equation leaves nothing for costs." : null),
    };
  });
}

/** The price rule in words, e.g. "cost ÷ 0.35: 50% gross profit, 15% commissions". */
export function forwardRuleWords(eq: PricingEquation): string {
  const pcm = projectCostMargin(eq);
  const commissions = eq.affiliate + eq.evaluator + eq.accountManager + eq.reserve;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return `cost ÷ ${+pcm.toFixed(2)}: ${pct(eq.grossProfit)} gross profit${commissions > 0 ? `, ${pct(commissions)} commissions` : ""}`;
}

/**
 * The pricing equation with the crew's pay from the team, for a business
 * that hasn't saved its own: the starting figures are a training example
 * ($45 a lead, $30 a technician), not anybody's pay. The best-paid hourly
 * person leads; the rest of the crew are paid the others' average. A
 * business that saved its own crew and pay keeps them.
 */
export function equationWithTeamPay(eq: PricingEquation, hourlyRatesDollars: number[], crewSize: number | null): PricingEquation {
  const rates = hourlyRatesDollars.filter((r) => Number.isFinite(r) && r > 0).sort((a, b) => b - a);
  if (rates.length === 0) return eq;
  const lead = rates[0];
  const rest = rates.slice(1);
  const tech = rest.length > 0 ? rest.reduce((a, b) => a + b, 0) / rest.length : lead;
  const crew = crewSize != null && crewSize >= 1 ? Math.round(crewSize) : eq.leads + eq.technicians;
  return { ...eq, leads: 1, leadRateCents: Math.round(lead * 100), technicians: Math.max(0, crew - 1), technicianRateCents: Math.round(tech * 100) };
}
