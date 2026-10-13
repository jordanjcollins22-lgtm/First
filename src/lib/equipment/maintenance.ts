/**
 * When each machine needs looking after.
 *
 * A service interval is "every N hours, N miles or N days, whichever comes
 * first", counted from the last time somebody recorded doing it. Hours and
 * miles come from the crew's end-of-day log; days come from the calendar.
 * Pure, so the rules can be tested without a database.
 *
 * A machine with no record of a task is "never logged", not overdue. A
 * twelve-year-old truck at 160,000 miles is not 32 oil changes behind, and
 * an alert saying so is noise that teaches people to ignore alerts. The panel
 * asks for the last date instead.
 */

import { addDays } from "@/lib/purchasing/takeoff";

export const EQUIPMENT_TYPES = ["truck", "trailer", "mower", "trimmer", "blower", "spreader", "plow", "salter", "other"] as const;
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

export const EQUIPMENT_TYPE_LABEL: Record<EquipmentType, string> = {
  truck: "Truck",
  trailer: "Trailer",
  mower: "Mower",
  trimmer: "Trimmer",
  blower: "Blower",
  spreader: "Spreader",
  plow: "Plow",
  salter: "Salter",
  other: "Other",
};

export type Meter = "miles" | "hours" | "none";

export interface Asset {
  id: string;
  name: string;
  /** fleet_assets.kind: truck, trailer, mower or other. */
  kind: string;
  /** The finer type, when somebody set one. */
  equipmentType: string | null;
  meter: Meter;
  mileage: number | null;
  engineHours: number | null;
}

export interface ServiceInterval {
  id: string;
  assetId: string | null;
  equipmentType: string | null;
  task: string;
  everyHours: number | null;
  everyMiles: number | null;
  everyDays: number | null;
  isDefault: boolean;
  active: boolean;
}

export interface ServiceRecord {
  assetId: string;
  task: string;
  doneOn: string;
  atHours: number | null;
  atMiles: number | null;
}

export function typeOf(asset: Pick<Asset, "kind" | "equipmentType">): EquipmentType {
  const t = (asset.equipmentType ?? asset.kind ?? "other").toLowerCase();
  return (EQUIPMENT_TYPES as readonly string[]).includes(t) ? (t as EquipmentType) : "other";
}

const taskKey = (task: string) => task.trim().toLowerCase();

/** The intervals that apply to one machine: its own, plus its type's where it has no own of the same task. */
export function intervalsFor(asset: Asset, intervals: readonly ServiceInterval[]): ServiceInterval[] {
  const own = intervals.filter((i) => i.active && i.assetId === asset.id);
  const ownTasks = new Set(own.map((i) => taskKey(i.task)));
  const type = typeOf(asset);
  const inherited = intervals.filter((i) => i.active && i.assetId == null && i.equipmentType === type && !ownTasks.has(taskKey(i.task)));
  return [...own, ...inherited];
}

/** The latest record of a task on a machine. */
export function lastRecord(assetId: string, task: string, records: readonly ServiceRecord[]): ServiceRecord | null {
  const k = taskKey(task);
  let best: ServiceRecord | null = null;
  for (const r of records) {
    if (r.assetId !== assetId || taskKey(r.task) !== k) continue;
    if (!best || r.doneOn > best.doneOn) best = r;
  }
  return best;
}

export type DueState = "ok" | "due_soon" | "overdue" | "never_logged";

export interface DueStatus {
  assetId: string;
  assetName: string;
  task: string;
  intervalId: string;
  isDefault: boolean;
  state: DueState;
  /** The date it falls due by the calendar, when the interval has days. */
  dueOn: string | null;
  dueAtHours: number | null;
  dueAtMiles: number | null;
  lastDoneOn: string | null;
  /** In words: "Due at 450 h (now 452 h)". */
  reason: string;
  /** One overdue stretch: the same until the task is done again. */
  dedupeKey: string;
}

export interface DueWindow {
  days: number;
  hours: number;
  miles: number;
}

export function dueStatus(asset: Asset, interval: ServiceInterval, last: ServiceRecord | null, today: string, soon: DueWindow): DueStatus {
  const base = {
    assetId: asset.id,
    assetName: asset.name,
    task: interval.task,
    intervalId: interval.id,
    isDefault: interval.isDefault,
    lastDoneOn: last?.doneOn ?? null,
    dedupeKey: `equipment:${asset.id}:${taskKey(interval.task)}:${last?.doneOn ?? "never"}`,
  };
  if (!last) {
    return { ...base, state: "never_logged", dueOn: null, dueAtHours: null, dueAtMiles: null, reason: "No record of when this was last done." };
  }

  const dueOn = interval.everyDays ? addDays(last.doneOn, interval.everyDays) : null;
  const dueAtHours = interval.everyHours && last.atHours != null ? last.atHours + interval.everyHours : null;
  const dueAtMiles = interval.everyMiles && last.atMiles != null ? last.atMiles + interval.everyMiles : null;

  const reasons: { state: DueState; text: string }[] = [];
  if (dueOn) {
    if (today >= dueOn) reasons.push({ state: "overdue", text: `Due ${dueOn}` });
    else if (today >= addDays(dueOn, -soon.days)) reasons.push({ state: "due_soon", text: `Due ${dueOn}` });
  }
  if (dueAtHours != null && asset.engineHours != null) {
    const now = `now ${round1(asset.engineHours)} h`;
    if (asset.engineHours >= dueAtHours) reasons.push({ state: "overdue", text: `Due at ${round1(dueAtHours)} h (${now})` });
    else if (asset.engineHours >= dueAtHours - soon.hours) reasons.push({ state: "due_soon", text: `Due at ${round1(dueAtHours)} h (${now})` });
  }
  if (dueAtMiles != null && asset.mileage != null) {
    const now = `now ${asset.mileage.toLocaleString("en-US")} mi`;
    if (asset.mileage >= dueAtMiles) reasons.push({ state: "overdue", text: `Due at ${dueAtMiles.toLocaleString("en-US")} mi (${now})` });
    else if (asset.mileage >= dueAtMiles - soon.miles) reasons.push({ state: "due_soon", text: `Due at ${dueAtMiles.toLocaleString("en-US")} mi (${now})` });
  }

  const overdue = reasons.filter((r) => r.state === "overdue");
  const dueSoon = reasons.filter((r) => r.state === "due_soon");
  const state: DueState = overdue.length ? "overdue" : dueSoon.length ? "due_soon" : "ok";
  const nextText = [dueOn ? `Next ${dueOn}` : null, dueAtHours != null ? `${round1(dueAtHours)} h` : null, dueAtMiles != null ? `${dueAtMiles.toLocaleString("en-US")} mi` : null]
    .filter(Boolean)
    .join(" or ");
  const reason = (overdue.length ? overdue : dueSoon).map((r) => r.text).join("; ") || nextText || "Nothing to measure it by yet.";
  return { ...base, state, dueOn, dueAtHours, dueAtMiles, reason };
}

/** Every task on every machine, worst first. */
export function allDue(
  assets: readonly Asset[],
  intervals: readonly ServiceInterval[],
  records: readonly ServiceRecord[],
  today: string,
  soon: DueWindow
): DueStatus[] {
  const order: Record<DueState, number> = { overdue: 0, due_soon: 1, never_logged: 2, ok: 3 };
  return assets
    .flatMap((asset) => intervalsFor(asset, intervals).map((interval) => dueStatus(asset, interval, lastRecord(asset.id, interval.task, records), today, soon)))
    .sort((a, b) => order[a.state] - order[b.state] || a.assetName.localeCompare(b.assetName) || a.task.localeCompare(b.task));
}

/**
 * Whether an overdue task should become an alert.
 *
 * Only once the alerts are switched on, and only for something that became
 * overdue on the business's watch: by the calendar after the switch, or on a
 * machine somebody has logged or serviced since. Everything that was already
 * overdue on the day it was switched on stays on the list without paging
 * anybody about the backlog.
 */
export function shouldRaiseAlert(input: {
  status: Pick<DueStatus, "state" | "dueOn">;
  startedAt: string | null;
  /** The newest usage log or service record on this machine, as an ISO time. */
  lastActivityAt: string | null;
}): boolean {
  if (input.status.state !== "overdue" || !input.startedAt) return false;
  const startedDay = input.startedAt.slice(0, 10);
  if (input.status.dueOn && input.status.dueOn >= startedDay) return true;
  return Boolean(input.lastActivityAt && input.lastActivityAt >= input.startedAt);
}

/* -------------------------------------------------------------------------
 * The end-of-day log
 * ---------------------------------------------------------------------- */

/**
 * What a machine's meters read after somebody logs the day.
 *
 * A reading only ever moves a meter forward: a typo of 1,200 for 12,000 must
 * not wind a truck's odometer back and make every service look not due. A
 * machine with no meter adds the hours it ran, and a corrected log replaces
 * the earlier figure rather than adding to it.
 */
export function applyUsage(
  asset: Pick<Asset, "meter" | "mileage" | "engineHours">,
  previous: { reading: number | null; usedHours: number | null } | null,
  next: { reading: number | null; usedHours: number | null }
): { mileage: number | null; engineHours: number | null } {
  if (asset.meter === "miles") {
    const reading = next.reading;
    return { mileage: reading == null ? asset.mileage : Math.max(asset.mileage ?? 0, Math.round(reading)), engineHours: asset.engineHours };
  }
  if (asset.meter === "hours") {
    const reading = next.reading;
    return { mileage: asset.mileage, engineHours: reading == null ? asset.engineHours : round1(Math.max(asset.engineHours ?? 0, reading)) };
  }
  const delta = (next.usedHours ?? 0) - (previous?.usedHours ?? 0);
  return { mileage: asset.mileage, engineHours: round1(Math.max(0, (asset.engineHours ?? 0) + delta)) };
}

/** A reading that is lower than the meter already says, which is a typo or a swapped meter. */
export function readingWarning(asset: Pick<Asset, "meter" | "mileage" | "engineHours" | "name">, reading: number | null): string | null {
  if (reading == null) return null;
  const current = asset.meter === "miles" ? asset.mileage : asset.meter === "hours" ? asset.engineHours : null;
  if (current == null || reading >= current) return null;
  return `${asset.name} already reads ${current.toLocaleString("en-US")}; ${reading.toLocaleString("en-US")} is lower, so it was kept.`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
