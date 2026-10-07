/**
 * A price from the pre-evaluation form alone, before anybody has seen the
 * property. Never shown to the client. It is for the call before the visit:
 * the client has sent photos, the county has the lot's size, and from those
 * we can give them a general number over the phone, a little higher than the
 * visit's because nobody has seen the yard yet.
 *
 * Every line is worked the way a proposal is: a size, the crew-hours that
 * size takes, labour at the crew rate, the materials it uses, then the
 * business's markup and overhead (priceZone, the same arithmetic the site
 * map uses). The breakdown is kept, so whoever makes the call can say where
 * any number came from.
 *
 * Where the rate card has no timing for a service, or a material has no
 * cost, a typical figure stands in and is marked "typical", so it is plain
 * which numbers are the business's and which are placeholders to set.
 *
 * And the other half of the same idea, for after the visit: what the client
 * asked for on the form beside what the evaluator put on the site map, so
 * what the evaluator added is plain to see.
 *
 * Pure, so the sizing and the comparison are tested without a database.
 */

import { priceZone } from "@/lib/job-costing";
import { zoneMaterialLineItems } from "@/lib/proposal-pricing";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import type { WorkZone } from "@/components/canvas/types";
import type { IntakeAnswers } from "@/lib/evaluation-intake";

/** How much more a price is before the yard has been seen. */
export const UNSEEN_PREMIUM = 0.2;

/** Assumed when the county has no lot for the address. */
const TYPICAL_LOT_SQFT = 10_000;

/** How much of the yard each part is, roughly. */
const AREA_SHARE: Record<string, number> = { front: 0.3, back: 0.45, sides: 0.15, foundation: 0.1 };

/**
 * Crew-minutes per square foot (or per item, for things counted), for a
 * service whose rate card has no timing yet. Rough, and marked as typical
 * wherever it is used.
 */
const TYPICAL_MINUTES: Record<string, number> = {
  "landscape-bed": 0.3,
  "lawn-care": 0.004,
  "lawn-restoration": 0.05,
  "landscape-cleanup": 0.03,
  trimming: 10,
  "plant-bush-removal": 45,
  "plant-installation": 30,
  "soft-washing": 0.05,
  grading: 1.5,
  snow: 0.02,
  "stone-removal": 0.25,
  "mulch-removal": 0.15,
  "sod-removal": 0.1,
};

/** A material's cost per unit, in cents, when the inventory has none. */
const TYPICAL_MATERIAL_CENTS: { name: RegExp; cents: number }[] = [
  { name: /mulch/i, cents: 3500 },
  { name: /seed/i, cents: 170 },
  { name: /rock|stone/i, cents: 15000 },
  { name: /topsoil/i, cents: 3500 },
];

export interface InstantMaterial {
  name: string;
  amount: string;
  cents: number | null;
  typical: boolean;
}

export interface InstantLine {
  /** The form's service, e.g. "beds". */
  service: string;
  /** What the line is, e.g. "Beds: mulch". */
  label: string;
  /** The rate card service it is priced as. Null for work with no service of its own. */
  priceAs: string | null;
  /** The size used, in words, e.g. "1,200 sq ft". */
  size: string | null;
  /** How that size was reached. */
  sizeFrom: string | null;
  crewHours: number;
  /** The timing used, e.g. "0.3 crew-min per sq ft". */
  rate: string | null;
  /** Whether the timing is the rate card's or a typical stand-in. */
  rateTypical: boolean;
  labourCents: number;
  materials: InstantMaterial[];
  materialsCents: number;
  /** Markup and overhead on top of labour and materials. */
  markupCents: number;
  /** Null when it can only be priced at the visit. */
  priceCents: number | null;
  /** Anything left out of the number, said. */
  note: string | null;
}

export interface InstantPrice {
  lines: InstantLine[];
  subtotalCents: number;
  premiumCents: number;
  totalCents: number;
  /** What the sizes were worked out from. */
  basis: string;
  crewRateCents: number;
  /** The markup in words, e.g. "× 2, then + 10% overhead". */
  markup: string;
  /** Whether any typical stand-in was used, so the rate card needs filling. */
  usesTypical: boolean;
}

type Catalog = Pick<CanvasCatalog, "servicePricing" | "serviceMaterialRules" | "materials" | "crewCostPerHourCents" | "markup" | "measurementUnit" | "measurementBasis">;

/** The parts of the yard, as a size is explained. */
const PART_NAME: Record<string, string> = { front: "front yard", back: "back yard", sides: "side yards", foundation: "ground around the house" };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const sqft = (n: number) => `${Math.round(n).toLocaleString("en-US")} sq ft`;

function yardShare(areas: string[]): number {
  if (areas.includes("whole")) return 1;
  if (areas.length === 0) return 0.5;
  return Math.min(1, areas.reduce((sum, a) => sum + (AREA_SHARE[a] ?? 0), 0));
}

/** One piece of work to price: a size (or a count), and what it uses. */
interface Work {
  service: string;
  label: string;
  /** The rate card service, or a key into TYPICAL_MINUTES for work with none. */
  typeId: string | null;
  areaSqft?: number;
  count?: number;
  countOf?: string;
  sizeFrom?: string;
  /** For the material rules: e.g. { material: "Mulch" }. */
  values?: Record<string, string>;
  /** Multiplies the hours: two storeys take longer than one. */
  hoursFactor?: number;
  note?: string;
}

export function instantPrice(
  answers: IntakeAnswers,
  lot: { lotSqft: number | null; structureSqft: number | null } | null,
  catalog: Catalog
): InstantPrice {
  const lotSqft = lot?.lotSqft ?? TYPICAL_LOT_SQFT;
  const structureSqft = lot?.structureSqft ?? 2000;
  const footprint = structureSqft / 1.6;
  const share = yardShare(answers.areas);
  const openYard = Math.max(1500, lotSqft - footprint - 800);
  const yard = openYard * share;
  const parts = answers.areas.includes("whole") || answers.areas.length === 0 ? ["the whole yard"] : answers.areas.map((a) => PART_NAME[a] ?? a);
  const yardFrom = `the ${parts.join(" and ").replace(/^the the /, "the ")} (${sqft(yard)} of open ground)`;
  const active = catalog.servicePricing.filter((p) => p.status === "active");
  const findByName = (pattern: RegExp) => active.find((p) => pattern.test(p.name))?.service_type_id ?? null;

  const picked = (id: string): string[] => {
    const v = answers.details[id];
    return Array.isArray(v) ? v : v ? [v] : [];
  };
  const has = (id: string, value: string) => picked(id).includes(value);

  const work: Work[] = answers.services.flatMap((service): Work[] => {
    switch (service) {
      case "beds": {
        const bed = clamp(yard * 0.12, 100, 2000);
        const bedFrom = `12% of ${yardFrom}`;
        const now = picked("beds_now");
        const mulch = has("beds_add", "mulch");
        const stone = has("beds_add", "stone");
        const out: Work[] = [];
        if (now.includes("stone") && mulch && !stone)
          out.push({ service, label: "Remove the old stone", typeId: "stone-removal", areaSqft: bed, sizeFrom: bedFrom });
        if (now.includes("old_mulch") && stone && !mulch)
          out.push({ service, label: "Remove the old mulch", typeId: "mulch-removal", areaSqft: bed, sizeFrom: bedFrom });
        if (now.includes("lawn")) out.push({ service, label: "Cut the grass out for the new bed", typeId: "sod-removal", areaSqft: bed, sizeFrom: bedFrom });
        if (mulch && stone) {
          out.push({ service, label: "Beds: full prep and mulch", typeId: "landscape-bed", areaSqft: bed / 2, sizeFrom: `half of ${bedFrom}`, values: { material: "Mulch" } });
          out.push({ service, label: "Beds: full prep and river rock", typeId: "landscape-bed", areaSqft: bed / 2, sizeFrom: `half of ${bedFrom}`, values: { material: "Rock" } });
        } else if (mulch || stone) {
          const material = mulch ? "Mulch" : "Rock";
          out.push({ service, label: `Beds: full prep and ${mulch ? "mulch" : "river rock"}`, typeId: "landscape-bed", areaSqft: bed, sizeFrom: bedFrom, values: { material } });
        } else {
          out.push({ service, label: "Beds: full prep", typeId: "landscape-bed", areaSqft: bed, sizeFrom: bedFrom });
        }
        if (has("beds_add", "plants"))
          out.push({ service, label: "Plant new plants", typeId: "plant-installation", count: 5, countOf: "plants", sizeFrom: "a typical first planting", note: "Labour only. The plants themselves are picked and priced on the visit." });
        return out;
      }
      case "lawn": {
        const need = picked("lawn_need");
        const lawnArea = clamp(yard * 0.7, 500, 40_000);
        const lawnFrom = `70% of ${yardFrom}`;
        const out: Work[] = [];
        if (need.includes("redo") || need.includes("patch")) {
          const whole = need.includes("redo");
          const sod = picked("lawn_method")[0] === "sod";
          out.push({
            service,
            label: whole ? "Lawn: redo the whole lawn" : "Lawn: fix the bare and thin spots",
            typeId: "lawn-restoration",
            areaSqft: whole ? lawnArea : lawnArea * 0.15,
            sizeFrom: whole ? lawnFrom : `15% of the lawn, ${lawnFrom}`,
            note: sod ? "Priced as seed. Sod costs more and is priced on the visit." : undefined,
          });
        }
        if (need.includes("mowing") || out.length === 0)
          out.push({ service, label: "Lawn: mowing, per visit", typeId: "lawn-care", areaSqft: lawnArea, sizeFrom: lawnFrom });
        if (need.includes("weeds") || need.includes("level")) out[out.length - 1].note = [out[out.length - 1].note, "Weeds and levelling are priced on the visit."].filter(Boolean).join(" ");
        return out;
      }
      case "cleanup": {
        const what = picked("cleanup_what");
        const out: Work[] = [{ service, label: "Cleanup", typeId: "landscape-cleanup", areaSqft: clamp(yard * 0.25, 200, 10_000), sizeFrom: `25% of ${yardFrom}` }];
        if (what.includes("trim") || what.includes("tall"))
          out.push({ service, label: "Trim shrubs and hedges", typeId: "trimming", count: 8, countOf: "shrubs", sizeFrom: "a typical yard", hoursFactor: what.includes("tall") ? 1.5 : 1 });
        return out;
      }
      case "removal": {
        const large = has("remove_what", "large") || has("remove_what", "bed");
        return [{ service, label: "Remove shrubs, roots and all", typeId: "plant-bush-removal", count: 3, countOf: "shrubs", sizeFrom: "a typical removal", hoursFactor: large ? 2 : 1 }];
      }
      case "drainage":
        return [{ service, label: "Drainage: regrade", typeId: "grading", areaSqft: 300, sizeFrom: "a typical problem area", note: "The real fix is set on the visit." }];
      case "washing": {
        const what = picked("wash_what");
        const stories = Number(picked("stories")[0] ?? "1") || 1;
        let area = 0;
        const parts: string[] = [];
        if (what.includes("siding") || what.length === 0) {
          area += clamp(structureSqft * 0.9, 800, 6000);
          parts.push("siding from the house's size");
        }
        if (what.includes("roof")) {
          area += footprint * 1.2;
          parts.push("roof from the footprint");
        }
        for (const extra of ["deck", "fence", "paving"]) {
          if (what.includes(extra)) {
            area += 300;
            parts.push(`300 sq ft of ${extra === "paving" ? "patio or walk" : extra}`);
          }
        }
        return [{ service, label: "Soft washing", typeId: "soft-washing", areaSqft: area, sizeFrom: parts.join(", "), hoursFactor: stories >= 3 ? 1.6 : stories === 2 ? 1.3 : 1 }];
      }
      case "snow":
        return [{ service, label: "Snow removal, per storm", typeId: findByName(/snow/i) ?? "snow", areaSqft: 800, sizeFrom: "a typical driveway and walk" }];
      default:
        return [{ service, label: service === "hardscape" ? "Patio, walkway or wall" : service === "holiday" ? "Holiday decorations" : "Something else", typeId: null }];
    }
  });

  let usesTypical = false;
  const lines = work.map((w): InstantLine => {
    const pricing = w.typeId ? active.find((p) => p.service_type_id === w.typeId) ?? null : null;
    const typicalKey = w.typeId && TYPICAL_MINUTES[w.typeId] != null ? w.typeId : w.typeId?.startsWith("custom-") && w.service === "snow" ? "snow" : null;
    const units = w.count ?? w.areaSqft ?? 0;
    const per = w.count != null ? (w.countOf ?? "item").replace(/s$/, "") : "sq ft";
    const size = w.count != null ? `${w.count} ${w.countOf ?? "items"}` : w.areaSqft != null ? sqft(w.areaSqft) : null;

    // The rate card's timing when it has one, and a typical rate otherwise.
    let crewHours = 0;
    let rate: string | null = null;
    let rateTypical = false;
    const cardMinutes = pricing?.minutes_per_sqft != null ? Number(pricing.minutes_per_sqft) : null;
    if (pricing && cardMinutes != null && (pricing.pricing_basis === "area" || pricing.pricing_basis === "count" || w.count != null)) {
      const crew = pricing.crew_size ?? 1;
      crewHours = (cardMinutes / 60) * units * crew;
      rate = `${cardMinutes} min per ${per}${crew > 1 ? ` × ${crew} crew` : ""}, from the rate card`;
    } else if (pricing?.estimated_hours != null) {
      crewHours = Number(pricing.estimated_hours);
      rate = `${crewHours} crew-hours, from the rate card`;
    } else if (typicalKey) {
      crewHours = (TYPICAL_MINUTES[typicalKey] / 60) * units;
      rate = `${TYPICAL_MINUTES[typicalKey]} crew-min per ${per}, typical`;
      rateTypical = true;
    }
    if (w.hoursFactor && w.hoursFactor !== 1) {
      crewHours *= w.hoursFactor;
      rate = `${rate}, × ${w.hoursFactor} for ${w.service === "washing" ? "the height" : "the size"}`;
    }

    if (!w.typeId || crewHours <= 0) {
      return { service: w.service, label: w.label, priceAs: pricing?.name ?? null, size, sizeFrom: w.sizeFrom ?? null, crewHours: 0, rate: null, rateTypical: false, labourCents: 0, materials: [], materialsCents: 0, markupCents: 0, priceCents: null, note: w.note ?? "Priced on the visit." };
    }
    if (rateTypical) usesTypical = true;

    // The materials the rate card's rules give this size, with a typical
    // cost standing in for one the inventory has no cost for.
    const materials: InstantMaterial[] = [];
    if (pricing && w.areaSqft != null) {
      const zone = { id: "instant", name: w.label, service: { typeId: pricing.service_type_id, values: w.values ?? {}, notes: "", photos: [], tools: [] } } as unknown as WorkZone;
      for (const item of zoneMaterialLineItems(zone, w.areaSqft, catalog as CanvasCatalog)) {
        const material = catalog.materials.find((m) => m.id === item.materialId);
        const typicalCents = TYPICAL_MATERIAL_CENTS.find((t) => t.name.test(item.material))?.cents ?? null;
        const cents = item.totalCost != null ? Math.round(item.totalCost * 100) : typicalCents != null ? Math.round(item.quantity * typicalCents) : null;
        const typical = item.totalCost == null && typicalCents != null;
        if (typical) usesTypical = true;
        const qty = item.quantity < 10 ? item.quantity.toFixed(1) : Math.round(item.quantity).toLocaleString("en-US");
        materials.push({ name: material?.name ?? item.material, amount: `${qty} ${item.unit}`, cents, typical });
      }
    }
    const materialsCents = materials.reduce((sum, m) => sum + (m.cents ?? 0), 0);
    const cost = priceZone({ materialsCents, crewHours, crewCostPerHourCents: catalog.crewCostPerHourCents }, catalog.markup);
    return {
      service: w.service,
      label: w.label,
      priceAs: pricing?.name ?? null,
      size,
      sizeFrom: w.sizeFrom ?? null,
      crewHours,
      rate,
      rateTypical,
      labourCents: cost.labourCents,
      materials,
      materialsCents: cost.materialsCents,
      markupCents: cost.priceCents - cost.directCostCents,
      priceCents: cost.priceCents > 0 ? cost.priceCents : null,
      note: w.note ?? (materials.some((m) => m.cents == null) ? "A material has no cost yet, so it is left out." : null),
    };
  });

  const subtotalCents = lines.reduce((sum, l) => sum + (l.priceCents ?? 0), 0);
  const totalCents = subtotalCents > 0 ? Math.ceil((subtotalCents * (1 + UNSEEN_PREMIUM)) / 2500) * 2500 : 0;
  const m = catalog.markup;
  const overhead = m.overheadPerCrewHourCents != null && m.overheadPerCrewHourCents > 0 ? `+ $${(m.overheadPerCrewHourCents / 100).toFixed(2)} per crew-hour overhead` : `+ ${m.overheadPercent}% overhead`;
  return {
    lines,
    subtotalCents,
    premiumCents: totalCents - subtotalCents,
    totalCents,
    basis: lot?.lotSqft ? `the county's lot size, ${sqft(lotSqft)}` : `a typical ${sqft(TYPICAL_LOT_SQFT)} lot`,
    crewRateCents: catalog.crewCostPerHourCents,
    markup: `× ${m.multiplier}, then ${overhead}`,
    usesTypical,
  };
}

/* ------------------------------------------------ asked for, then found */

/** Which of the rate card's services each of the form's services covers. */
const COVERS: Record<string, { ids: string[]; names?: RegExp }> = {
  beds: { ids: ["landscape-bed", "plant-installation"], names: /mulch|bed|plant/i },
  lawn: { ids: ["lawn-care", "lawn-restoration"], names: /lawn|mow|seed|sod|aerat/i },
  cleanup: { ids: ["landscape-cleanup", "trimming", "leaf-seasonal-cleanup"], names: /clean|trim|leaf|weed|prun/i },
  removal: { ids: ["plant-bush-removal"], names: /remov|junk/i },
  drainage: { ids: ["grading"], names: /grad|drain/i },
  hardscape: { ids: [], names: /patio|walk|wall|paver|hardscape/i },
  washing: { ids: ["soft-washing"], names: /wash/i },
  holiday: { ids: [], names: /holiday|christmas|light/i },
  snow: { ids: [], names: /snow/i },
};

function covered(service: string, area: { typeId: string; label: string }): boolean {
  const rule = COVERS[service];
  if (!rule) return false;
  return rule.ids.includes(area.typeId) || Boolean(rule.names?.test(area.label));
}

export interface UpsellComparison {
  /** What they asked for on the form, by the form's service. */
  asked: string[];
  /** Areas on the site map that nothing they asked for covers: what the evaluator added. */
  added: { label: string; priceCents: number }[];
  /** What they asked for that is nowhere on the site map. */
  notOnMap: string[];
  addedCents: number;
}

/**
 * What the client asked for beside what the evaluator drew. An area is an
 * addition when none of the services they picked covers it; "Something
 * else" is not counted as asking for everything.
 */
export function compareUpsell(asked: string[], areas: { typeId: string; label: string; priceCents: number }[]): UpsellComparison {
  const wanted = asked.filter((s) => s !== "other");
  const added = areas.filter((area) => !wanted.some((service) => covered(service, area)));
  const byLabel = new Map<string, number>();
  for (const area of added) byLabel.set(area.label, (byLabel.get(area.label) ?? 0) + Math.max(0, area.priceCents));
  return {
    asked,
    added: [...byLabel.entries()].map(([label, priceCents]) => ({ label, priceCents })),
    notOnMap: wanted.filter((service) => !areas.some((area) => covered(service, area))),
    addedCents: added.reduce((sum, a) => sum + Math.max(0, a.priceCents), 0),
  };
}
