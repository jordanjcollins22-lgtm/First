/**
 * Timing each service on the job, so production rates come from real work.
 *
 * On site, the crew start a timer on a service in an area (hand weed pulling
 * in Zone 1) and stop it when it is done, saying how much got done and how
 * many people were on it. Every one is kept with its job. Across all jobs,
 * a service's production rate is the work done over the labour-hours it
 * took:
 *
 *   PR per labour-hour = ΣQ ÷ Σ(clock hours × people)
 *   PR per crew-hour   = that × the people on a standard crew
 *
 * The second is what the price uses, since its hours are crew-hours. Adding
 * up the work and the hours, rather than averaging each job's rate, weighs a
 * big job by its size: one 50 sq ft patch that went fast doesn't count as
 * much as a 2,000 sq ft bed.
 *
 * Pure, so it is tested without a database.
 */

import type { PriceLine, ProductionService, ProductionUnit } from "@/lib/forward-pricing";

export interface ServiceTimeLog {
  id: string;
  jobId: string;
  jobNumber: number | null;
  /** The job's address, to say which job it was. */
  where: string | null;
  zoneId: string;
  zoneName: string;
  serviceKey: string;
  unit: ProductionUnit;
  /** Q: how much got done. Null while the timer is running. */
  quantity: number | null;
  startedAt: string;
  finishedAt: string | null;
  /** How many people were on it. */
  people: number | null;
  /** Left out of the average by the office: a timer left running, a mistake. */
  excluded: boolean;
  /** Who started it, by first name. */
  by: string | null;
}

export function clockHours(log: Pick<ServiceTimeLog, "startedAt" | "finishedAt">): number | null {
  if (!log.finishedAt) return null;
  const ms = new Date(log.finishedAt).getTime() - new Date(log.startedAt).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms / 3_600_000 : null;
}

/** ALH: the clock times the people on it. */
export function labourHours(log: Pick<ServiceTimeLog, "startedAt" | "finishedAt" | "people">): number | null {
  const h = clockHours(log);
  return h != null && log.people != null && log.people > 0 ? h * log.people : null;
}

/** Whether a log counts toward the average: finished, with work and hours, and not left out. */
export function counts(log: ServiceTimeLog): boolean {
  return !log.excluded && log.quantity != null && log.quantity > 0 && (labourHours(log) ?? 0) > 0;
}

/** This one job's rate, per crew-hour of a standard crew. */
export function jobRate(log: ServiceTimeLog, crewPeople: number): number | null {
  const alh = labourHours(log);
  return alh && log.quantity ? (log.quantity / alh) * crewPeople : null;
}

export interface ServiceAverage {
  /** Timed runs that count. */
  runs: number;
  /** Different jobs among them. */
  jobs: number;
  quantity: number;
  labourHours: number;
  /** ΣQ ÷ ΣALH. */
  perLabourHour: number;
  /** The same for the standard crew: what goes in PR. */
  perCrewHour: number;
}

export function averageRate(logs: ServiceTimeLog[], crewPeople: number): ServiceAverage | null {
  const used = logs.filter(counts);
  if (used.length === 0 || crewPeople <= 0) return null;
  const quantity = used.reduce((s, l) => s + l.quantity!, 0);
  const hours = used.reduce((s, l) => s + labourHours(l)!, 0);
  const perLabourHour = quantity / hours;
  return {
    runs: used.length,
    jobs: new Set(used.map((l) => l.jobId)).size,
    quantity,
    labourHours: hours,
    perLabourHour,
    perCrewHour: perLabourHour * crewPeople,
  };
}

/** A rate rounded to something worth typing: 537.4 → 540, 2.46 → 2.5, 11.6 → 12. */
export function roundRate(pr: number): number {
  if (pr >= 100) return Math.round(pr / 10) * 10;
  if (pr >= 10) return Math.round(pr);
  return Math.round(pr * 10) / 10;
}

/** One service on one area of the job, to be timed. */
export interface TimedService {
  zoneId: string;
  zoneName: string;
  key: string;
  label: string;
  unit: ProductionUnit;
  /** What it was priced at, as the starting answer for how much got done. */
  plannedQuantity: number;
}

/**
 * The services to time on a job: every priced service on every area, as the
 * proposal was approved with them. Per-job costs (disposal) have no crew
 * time and are left off.
 */
export function servicesToTime(areas: { zoneId: string; zoneName: string; lines: PriceLine[] }[], services: ProductionService[]): TimedService[] {
  const seen = new Set<string>();
  return areas.flatMap((area) =>
    area.lines.flatMap((line) => {
      const s = services.find((x) => x.key === line.key);
      const id = `${area.zoneId}|${line.key}`;
      if (!s || s.unit === "job" || s.pr == null || seen.has(id)) return [];
      seen.add(id);
      return [{ zoneId: area.zoneId, zoneName: area.zoneName, key: s.key, label: s.label, unit: s.unit, plannedQuantity: line.quantity }];
    })
  );
}

/** "1 hr 20 min", "45 min", "2 hr". */
export function hoursLabel(hours: number): string {
  const total = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}
