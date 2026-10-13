import { addDays, inRange, localDay, BUSINESS_TZ } from "@/lib/finance/dates";

/**
 * A payroll week: hours per person, from the time clock where they clocked
 * in and from the crew's day events (left the shop … back at the shop)
 * where they didn't, plus the commission each is owed. Then the same week
 * as the CSV Gusto or ADP imports. Pure, so the rules are tested.
 */

export interface ClockEntry {
  profileId: string;
  clockedInAt: string;
  clockedOutAt: string | null;
}

export interface DayEvent {
  profileId: string;
  /** "YYYY-MM-DD" the crew day belongs to. */
  day: string;
  kind: string;
  at: string;
}

export interface Person {
  id: string;
  firstName: string;
  lastName: string;
  /** The payroll provider's id for them (Gusto employee id, ADP file #). */
  payrollId?: string | null;
}

export interface PayrollLine {
  profileId: string;
  firstName: string;
  lastName: string;
  payrollId: string | null;
  regularHours: number;
  overtimeHours: number;
  totalHours: number;
  commission: number;
  /** Days counted from crew events because nothing was clocked. */
  fromEvents: number;
  /** Clock-ins left open; not counted. */
  openEntries: number;
  /** Hours per day, Monday first. */
  days: number[];
}

/** Overtime past 40 hours in the week (FLSA; Maryland follows it for most work). */
export const OVERTIME_AFTER = 40;
/** A crew day longer than this is a forgotten "back at the shop", not a shift. */
export const MAX_EVENT_DAY_HOURS = 16;

const START_KINDS = new Set(["arrived_shop", "left_shop", "travelling", "arrived_job"]);
const END_KINDS = new Set(["returned_shop", "finished_job"]);

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Hours a crew day lasted from its events: first start to last finish. Null when it can't be told. */
export function hoursFromEvents(events: DayEvent[]): number | null {
  const starts = events.filter((e) => START_KINDS.has(e.kind)).map((e) => Date.parse(e.at)).filter(Number.isFinite);
  const ends = events.filter((e) => END_KINDS.has(e.kind)).map((e) => Date.parse(e.at)).filter(Number.isFinite);
  if (!starts.length || !ends.length) return null;
  const hours = (Math.max(...ends) - Math.min(...starts)) / 3_600_000;
  if (!(hours > 0) || hours > MAX_EVENT_DAY_HOURS) return null;
  return r2(hours);
}

/**
 * The week's lines. A person-day with any clocked time uses the clock; a
 * person-day with none falls back to the crew events, so a crew that only
 * taps "left the shop" and "back at the shop" still gets paid right.
 */
export function payrollWeek(input: {
  weekStart: string;
  people: Person[];
  entries: ClockEntry[];
  events: DayEvent[];
  commissions?: Map<string, number>;
  tz?: string;
}): PayrollLine[] {
  const tz = input.tz ?? BUSINESS_TZ;
  const weekEnd = addDays(input.weekStart, 6);
  const dayIndex = (day: string) => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${input.weekStart}T00:00:00Z`)) / 86_400_000);

  const clock = new Map<string, number[]>();
  const open = new Map<string, number>();
  for (const e of input.entries) {
    const day = localDay(e.clockedInAt, tz);
    if (!inRange(day, input.weekStart, weekEnd)) continue;
    if (!e.clockedOutAt) {
      open.set(e.profileId, (open.get(e.profileId) ?? 0) + 1);
      continue;
    }
    const hours = (Date.parse(e.clockedOutAt) - Date.parse(e.clockedInAt)) / 3_600_000;
    if (!(hours > 0)) continue;
    const days = clock.get(e.profileId) ?? Array(7).fill(0);
    days[dayIndex(day)] += hours;
    clock.set(e.profileId, days);
  }

  const evByPersonDay = new Map<string, DayEvent[]>();
  for (const e of input.events) {
    if (!inRange(e.day, input.weekStart, weekEnd)) continue;
    const key = `${e.profileId}|${e.day}`;
    evByPersonDay.set(key, [...(evByPersonDay.get(key) ?? []), e]);
  }

  const lines: PayrollLine[] = [];
  for (const p of input.people) {
    const days = [...(clock.get(p.id) ?? Array(7).fill(0))];
    let fromEvents = 0;
    for (let i = 0; i < 7; i++) {
      if (days[i] > 0) continue;
      const evs = evByPersonDay.get(`${p.id}|${addDays(input.weekStart, i)}`);
      const h = evs ? hoursFromEvents(evs) : null;
      if (h) {
        days[i] = h;
        fromEvents++;
      }
    }
    const total = r2(days.reduce((s, h) => s + h, 0));
    const commission = r2(input.commissions?.get(p.id) ?? 0);
    if (total === 0 && commission === 0 && !open.get(p.id)) continue;
    lines.push({
      profileId: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      payrollId: p.payrollId ?? null,
      regularHours: r2(Math.min(total, OVERTIME_AFTER)),
      overtimeHours: r2(Math.max(0, total - OVERTIME_AFTER)),
      totalHours: total,
      commission,
      fromEvents,
      openEntries: open.get(p.id) ?? 0,
      days: days.map(r2),
    });
  }
  return lines.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
}

/** One CSV cell, quoted when it must be. A leading = + - @ is defused so a spreadsheet won't run it. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(s) && typeof value === "string") s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csv = (rows: (string | number | null)[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
const money = (n: number) => (n ? n.toFixed(2) : "");
const hrs = (n: number) => (n ? n.toFixed(2) : "");

/**
 * Gusto's "import hours" spreadsheet: one row per employee, matched on
 * gusto_employee_id when given and on name otherwise. Columns Gusto doesn't
 * need filled are left blank.
 */
export const GUSTO_HEADER = [
  "last_name",
  "first_name",
  "title",
  "gusto_employee_id",
  "regular_hours",
  "overtime_hours",
  "double_overtime_hours",
  "holiday_hours",
  "bonus",
  "commission",
  "paycheck_tips",
  "cash_tips",
  "correction_payment",
  "reimbursement",
  "personal_note",
];

export function gustoCsv(lines: PayrollLine[]): string {
  return csv([
    GUSTO_HEADER,
    ...lines.map((l) => [l.lastName, l.firstName, "", l.payrollId ?? "", hrs(l.regularHours), hrs(l.overtimeHours), "", "", "", money(l.commission), "", "", "", "", ""]),
  ]);
}

/**
 * ADP's paydata import (Workforce Now / RUN "EPI" layout): company code,
 * batch, the employee's file number, regular and overtime hours, and
 * commission as a coded earning. The company code and the commission
 * earnings code are the ones in the business's own ADP setup.
 */
export const ADP_HEADER = ["Co Code", "Batch ID", "File #", "Employee Name", "Reg Hours", "O/T Hours", "Earnings 3 Code", "Earnings 3 Amount"];

export function adpCsv(lines: PayrollLine[], opts: { companyCode?: string; batchId: string; commissionCode?: string }): string {
  return csv([
    ADP_HEADER,
    ...lines.map((l) => [
      opts.companyCode ?? "",
      opts.batchId,
      l.payrollId ?? "",
      `${l.lastName}, ${l.firstName}`,
      hrs(l.regularHours),
      hrs(l.overtimeHours),
      l.commission ? (opts.commissionCode ?? "C") : "",
      money(l.commission),
    ]),
  ]);
}

/** Names from a full name, for providers that want them apart. */
export function splitName(full: string | null | undefined, first?: string | null, last?: string | null): { firstName: string; lastName: string } {
  if (first || last) return { firstName: first ?? "", lastName: last ?? "" };
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}
