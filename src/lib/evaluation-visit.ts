/**
 * The evaluator's visit, from their own screen: where each visit is up to,
 * and the site map set-up they go through on site.
 *
 * The client's pre-evaluation form is a recommendation laid over the site
 * map, not the site map itself: each service they asked for, in each part
 * of the yard they picked, shows on the map as a suggestion. The evaluator
 * ticks it, and it becomes an area on the site map with its service set,
 * or crosses it out. Anything the client did not ask for is drawn or added
 * as usual. Then they measure and submit.
 *
 * Pure, so the rules are tested without a database.
 */

import { PHOTO_AREAS, photoAreasFor, type IntakeAnswers } from "@/lib/evaluation-intake";

export interface PlanItem {
  /** Stable, and the id of the zone it becomes on the site map. */
  id: string;
  /** The part of the yard: front, back, sides, foundation or whole. */
  area: string;
  /** The form's service, e.g. "beds". Null for something the evaluator added. */
  service: string | null;
  /** The rate card service it is priced as. Null when the evaluator picks it on the map. */
  typeId: string | null;
  /** The service's values on the site map, e.g. { material: "Mulch" }. */
  values?: Record<string, string>;
  /** What it is, e.g. "Beds: mulch". */
  label: string;
  /**
   * Ticked, so an area on the site map (true); crossed out (false); or
   * still a suggestion from their pre-eval, waiting for the evaluator (null).
   */
  keep: boolean | null;
  /** Added by the evaluator on site, not asked for on the form. */
  added?: boolean;
}

export type VisitStage = "booked" | "on_way" | "arrived" | "submitted";

export function visitStage(job: {
  evaluation_status: string;
  evaluator_on_way_at?: string | null;
  evaluator_arrived_at?: string | null;
}): VisitStage {
  if (job.evaluation_status === "completed") return "submitted";
  if (job.evaluation_status === "arrived" || job.evaluator_arrived_at) return "arrived";
  if (job.evaluation_status === "on_way" || job.evaluator_on_way_at) return "on_way";
  return "booked";
}

export function areaLabel(area: string): string {
  return PHOTO_AREAS.find((a) => a.value === area)?.label ?? area;
}

/** The rate card service each of the form's services is, and what it needs set. */
function priceAs(
  service: string,
  answers: IntakeAnswers,
  findByName: (pattern: RegExp) => string | null
): { typeId: string | null; values?: Record<string, string>; label: string }[] {
  const picked = (id: string): string[] => {
    const v = answers.details[id];
    return Array.isArray(v) ? v : v ? [v] : [];
  };
  switch (service) {
    case "beds": {
      const add = picked("beds_add");
      const out: { typeId: string | null; values?: Record<string, string>; label: string }[] = [];
      if (add.includes("mulch")) out.push({ typeId: "landscape-bed", values: { material: "Mulch" }, label: "Beds: mulch" });
      if (add.includes("stone")) out.push({ typeId: "landscape-bed", values: { material: "Rock" }, label: "Beds: river rock" });
      if (out.length === 0) out.push({ typeId: "landscape-bed", label: "Beds" });
      if (add.includes("plants")) out.push({ typeId: "plant-installation", label: "New plants" });
      return out;
    }
    case "lawn": {
      const need = picked("lawn_need");
      const out: { typeId: string | null; label: string }[] = [];
      if (need.includes("redo") || need.includes("patch")) out.push({ typeId: "lawn-restoration", label: need.includes("redo") ? "Lawn: redo" : "Lawn: repair" });
      if (need.includes("mowing") || out.length === 0) out.push({ typeId: "lawn-care", label: "Lawn: mowing" });
      return out;
    }
    case "cleanup": {
      const what = picked("cleanup_what");
      const out: { typeId: string | null; label: string }[] = [{ typeId: "landscape-cleanup", label: "Cleanup" }];
      if (what.includes("trim") || what.includes("tall")) out.push({ typeId: "trimming", label: "Trimming" });
      return out;
    }
    case "removal":
      return [{ typeId: "plant-bush-removal", label: "Shrub removal" }];
    case "drainage":
      return [{ typeId: "grading", label: "Drainage" }];
    case "washing":
      return [{ typeId: "soft-washing", label: "Soft washing" }];
    case "snow":
      return [{ typeId: findByName(/snow/i), label: "Snow removal" }];
    case "hardscape":
      return [{ typeId: null, label: "Patio, walkway or wall" }];
    case "holiday":
      return [{ typeId: null, label: "Holiday decorations" }];
    default:
      return [{ typeId: null, label: answers.services_other ? `Something else: ${answers.services_other}` : "Something else" }];
  }
}

/** Work that is done to the house, not to a part of the yard: one piece, not one per part. */
const WHOLE_HOUSE = new Set(["washing", "snow", "holiday", "drainage", "other", "hardscape"]);

/**
 * The pieces of work from the client's form: each service in each part of
 * the yard they picked. Washing, snow and the like are one piece for the
 * whole property rather than one per part.
 */
export function seedPlan(answers: IntakeAnswers, findByName: (pattern: RegExp) => string | null = () => null): PlanItem[] {
  const areas = photoAreasFor(answers.areas);
  const items: PlanItem[] = [];
  for (const service of answers.services) {
    const where = WHOLE_HOUSE.has(service) ? ["whole"] : areas;
    for (const area of where) {
      for (const [i, as] of priceAs(service, answers, findByName).entries()) {
        items.push({
          id: `seed-${area}-${service}-${i}`,
          area,
          service,
          typeId: as.typeId,
          ...(as.values ? { values: as.values } : {}),
          label: as.label,
          // A suggestion until the evaluator ticks or crosses it.
          keep: null,
        });
      }
    }
  }
  return items;
}

/**
 * What was saved on site, brought up to date with the form: anything
 * taken off stays off, anything added on site stays, and a piece of work
 * the form now asks for that was not there before comes in on the map.
 */
export function mergePlan(saved: PlanItem[] | null | undefined, seeded: PlanItem[]): PlanItem[] {
  if (!saved || saved.length === 0) return seeded;
  const have = new Set(saved.map((i) => i.id));
  return [...saved, ...seeded.filter((i) => !have.has(i.id))];
}

/** Reads a saved plan back, dropping anything that is not the shape it should be. */
export function readPlan(raw: unknown): PlanItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i): i is Record<string, unknown> => Boolean(i) && typeof i === "object")
    .filter((i) => typeof i.id === "string" && typeof i.area === "string" && typeof i.label === "string")
    .map((i) => ({
      id: i.id as string,
      area: i.area as string,
      service: typeof i.service === "string" ? i.service : null,
      typeId: typeof i.typeId === "string" ? i.typeId : null,
      ...(i.values && typeof i.values === "object" ? { values: i.values as Record<string, string> } : {}),
      label: (i.label as string).slice(0, 120),
      keep: i.keep === true ? true : i.keep === false ? false : null,
      ...(i.added ? { added: true } : {}),
    }));
}

/** A piece of work the evaluator adds on site. */
export function addedItem(area: string, typeId: string, label: string, id: string): PlanItem {
  return { id: `add-${id}`, area, service: null, typeId, label, keep: true, added: true };
}

export interface ZoneSeed {
  id: string;
  name: string;
  location: string;
  area: string;
  typeId: string | null;
  values: Record<string, string>;
}

/** The pieces ticked or added, as areas on the site map. */
export function zoneSeeds(items: PlanItem[]): ZoneSeed[] {
  return asSeeds(items.filter((i) => i.keep === true));
}

/** Their pre-eval's suggestions not yet ticked or crossed out, laid over the map. */
export function suggestionSeeds(items: PlanItem[]): ZoneSeed[] {
  return asSeeds(items.filter((i) => i.keep === null));
}

function asSeeds(items: PlanItem[]): ZoneSeed[] {
  return items
    .map((i) => ({
      id: i.id,
      name: `${areaLabel(i.area)} · ${i.label}`,
      location: areaLabel(i.area),
      area: i.area,
      typeId: i.typeId,
      values: i.values ?? {},
    }));
}

/** Zones made from the set-up carry its ids; anything else was drawn by hand. */
export function isSeededZone(id: string): boolean {
  return id.startsWith("seed-") || id.startsWith("add-");
}

/* ------------------------------------------------------ the evaluator's day */

export interface VisitRow {
  id: string;
  evaluationDate: string;
  evaluationStatus: string;
  jobStatus: string;
}

/** The calendar day a moment falls on, where the business is. */
export function dayIn(at: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

const UPCOMING_DAYS = 21;

/**
 * An evaluator's visits in three piles: today, the next three weeks, and the
 * ones already visited that were never written up. Cancelled ones are left
 * out; a written-up visit from the past is done and left out too.
 */
export function groupVisits<T extends VisitRow>(rows: T[], now: Date, timeZone: string): { today: T[]; upcoming: T[]; toWriteUp: T[] } {
  const today = dayIn(now, timeZone);
  const horizon = dayIn(new Date(now.getTime() + UPCOMING_DAYS * 86_400_000), timeZone);
  const live = rows.filter((r) => r.evaluationStatus !== "cancelled" && r.jobStatus !== "cancelled");
  const byTime = (a: T, b: T) => a.evaluationDate.localeCompare(b.evaluationDate);
  return {
    today: live.filter((r) => dayIn(r.evaluationDate, timeZone) === today).sort(byTime),
    upcoming: live
      .filter((r) => {
        const day = dayIn(r.evaluationDate, timeZone);
        return day > today && day <= horizon;
      })
      .sort(byTime),
    toWriteUp: live
      // Still at the estimate: a job quoted or signed some other way is not owed a site map.
      .filter((r) => dayIn(r.evaluationDate, timeZone) < today && r.evaluationStatus !== "completed" && r.jobStatus === "estimating")
      .sort(byTime)
      .reverse(),
  };
}
