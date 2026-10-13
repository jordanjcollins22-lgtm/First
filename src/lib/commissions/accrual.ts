/**
 * Commission that accrues itself.
 *
 * When a payment lands (Stripe's invoice.paid, or a cheque recorded on the
 * job), each person who carried the job earns their share of that payment
 * at their rate on file: the account manager who sold it, the evaluator
 * whose site map priced it, the affiliate who brought it. The shares are the
 * same pool split the Money page already uses (commission-split.ts); this
 * file only turns one payment into rows.
 *
 * Each week the rows that have become payable are batched into one
 * statement per person, and the owner approves one total.
 *
 * Hold-back, off by default: an account manager's and an evaluator's share
 * is paid X% on collection, and the rest only once the job has closed at
 * the target gross margin or better. The affiliate's share is never held
 * back: they brought the lead and have no hand in the margin.
 *
 * Pure, so the money rules are tested without a database.
 */

import { sharesFor, usesSplit, type JobRoles, type PoolRole } from "@/lib/commission-split";
import { DEFAULT_ACCOUNT_MANAGER_PCT } from "@/lib/commission";

export interface RateDefaults {
  account_manager: number;
  evaluator: number;
  affiliate: number;
}

export interface HoldbackSettings {
  on: boolean;
  /** Percent of the commission paid on collection. The rest waits for the margin. */
  collectPct: number;
  /** Gross margin, in percent, the job must close at to release the rest. */
  marginPct: number;
}

export interface AccrualRow {
  profileId: string;
  role: PoolRole;
  pct: number;
  baseAmount: number;
  amount: number;
  portion: "collection" | "holdback";
  payOnCollect: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A person's rate for one share: their own rate on file for that role, or
 * the business default.
 */
export function rateFor(profileId: string, role: PoolRole, onFile: ReadonlyMap<string, number>, defaults: RateDefaults): number {
  return onFile.get(`${profileId}:${role}`) ?? defaults[role];
}

/**
 * The rows one payment produces.
 *
 * A job sold before the pool started keeps the deal it was sold on: the
 * account manager alone, at their own commission_pct (`legacyPct`). Owners
 * earn nothing; their share stays with the business. An evaluator's or
 * affiliate's share is only earned once the client has said yes, which a
 * payment against the job already says.
 */
export function accrualsForPayment(input: {
  amount: number;
  roles: JobRoles;
  soldAt: string | null;
  splitFrom: string;
  owners: ReadonlySet<string>;
  ratesOnFile: ReadonlyMap<string, number>;
  defaults: RateDefaults;
  legacyPct: ReadonlyMap<string, number | null>;
  holdback: HoldbackSettings;
}): AccrualRow[] {
  const base = round2(input.amount);
  if (!(base > 0)) return [];

  const rows: AccrualRow[] = [];
  const push = (profileId: string, role: PoolRole, pct: number) => {
    const total = round2((pct / 100) * base);
    if (!(total > 0)) return;
    const holds = input.holdback.on && role !== "affiliate";
    if (!holds) {
      rows.push({ profileId, role, pct, baseAmount: base, amount: total, portion: "collection", payOnCollect: role === "affiliate" });
      return;
    }
    const now = round2((Math.min(100, Math.max(0, input.holdback.collectPct)) / 100) * total);
    const later = round2(total - now);
    if (now > 0) rows.push({ profileId, role, pct, baseAmount: base, amount: now, portion: "collection", payOnCollect: true });
    if (later > 0) rows.push({ profileId, role, pct, baseAmount: base, amount: later, portion: "holdback", payOnCollect: false });
  };

  if (!usesSplit(input.soldAt, input.splitFrom)) {
    const manager = input.roles.accountManagerId;
    if (manager && !input.owners.has(manager)) {
      push(manager, "account_manager", input.legacyPct.get(manager) ?? DEFAULT_ACCOUNT_MANAGER_PCT);
    }
    return rows;
  }

  for (const share of sharesFor(input.roles, input.owners)) {
    for (const role of share.roles) push(share.profileId, role, rateFor(share.profileId, role, input.ratesOnFile, input.defaults));
  }
  return rows;
}

/** Gross margin in percent from the job's recorded final costs, or null when they are not in. */
export function grossMarginPct(input: {
  priceCents: number;
  crewHours: number | null;
  crewCostPerHourCents: number;
  materialsCents: number | null;
  otherCents: number | null;
}): number | null {
  if (!(input.priceCents > 0) || input.crewHours == null) return null;
  const cost = input.crewHours * input.crewCostPerHourCents + (input.materialsCents ?? 0) + (input.otherCents ?? 0);
  return Math.round(((input.priceCents - cost) / input.priceCents) * 1000) / 10;
}

export interface JobGate {
  status: string;
  openTickets: number;
  designIssues: number;
  /** Null when the job's final costs are not recorded. */
  marginPct: number | null;
}

/**
 * Whether one accrued row may go on this week's statement, and if not, why.
 *
 * - Hold-back: once the job is completed at the target margin or better.
 * - Payable on collection: now.
 * - Otherwise (an account manager's or evaluator's share without hold-back):
 *   at the sign-off, as the Money page has always paid it: the job
 *   completed with nothing open on it. An evaluator's share waits while an
 *   issue traces back to the site map.
 */
export function payableNow(
  row: { role: PoolRole; portion: "collection" | "holdback"; payOnCollect: boolean },
  job: JobGate,
  holdback: Pick<HoldbackSettings, "marginPct">
): { payable: boolean; reason: string | null } {
  if (job.status === "cancelled") return { payable: false, reason: "The job was cancelled." };
  if (row.portion === "holdback") {
    if (job.status !== "completed") return { payable: false, reason: "Held back until the job closes." };
    if (job.marginPct == null) return { payable: false, reason: "Held back: the job's final costs aren't recorded, so its margin is unknown." };
    if (job.marginPct < holdback.marginPct) {
      return { payable: false, reason: `Held back: the job closed at ${job.marginPct}% gross margin, under the ${holdback.marginPct}% target.` };
    }
    return { payable: true, reason: null };
  }
  if (row.role === "evaluator" && job.designIssues > 0) {
    return { payable: false, reason: "An issue on this job traced back to the site map." };
  }
  if (row.payOnCollect) return { payable: true, reason: null };
  if (job.status !== "completed") return { payable: false, reason: "Paid at the sign-off: the job isn't finished yet." };
  if (job.openTickets > 0) return { payable: false, reason: "A ticket is still open on this job." };
  return { payable: true, reason: null };
}

/**
 * The Monday-to-Sunday week that ended most recently before `now`, in the
 * business's time zone. The batch for a week is built any time after it
 * ends, so a missed run catches up the next day.
 */
export function lastCompletedWeek(now: Date, timeZone = "America/New_York"): { weekStart: string; weekEnd: string } {
  const local = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const today = new Date(`${local}T12:00:00Z`);
  const dow = today.getUTCDay(); // 0 Sunday
  const sinceMonday = (dow + 6) % 7;
  const thisMonday = new Date(today.getTime() - sinceMonday * 86_400_000);
  const lastMonday = new Date(thisMonday.getTime() - 7 * 86_400_000);
  const lastSunday = new Date(thisMonday.getTime() - 86_400_000);
  return { weekStart: lastMonday.toISOString().slice(0, 10), weekEnd: lastSunday.toISOString().slice(0, 10) };
}

export interface OpenAccrual {
  id: string;
  profileId: string;
  jobId: string;
  amount: number;
}

export interface StatementLine {
  jobId: string;
  amount: number;
  /** Taken off because it was already paid by hand. */
  offset: number;
  accrualIds: string[];
}

export interface Statement {
  profileId: string;
  total: number;
  lines: StatementLine[];
}

/**
 * One statement per person from the rows that are payable this week.
 *
 * `paidByHand` is commission somebody has recorded on the Money page since
 * accrual was switched on, per `${jobId}:${profileId}`, less what earlier
 * statements already took off for it. It is taken off first, so a job paid
 * by hand is not paid again, and each line says how much it absorbed so the
 * next week does not take the same hand payment off twice.
 */
export function buildStatements(
  payable: OpenAccrual[],
  paidByHand: ReadonlyMap<string, number> = new Map()
): Statement[] {
  const byPersonJob = new Map<string, OpenAccrual[]>();
  for (const a of payable) {
    const key = `${a.jobId}:${a.profileId}`;
    byPersonJob.set(key, [...(byPersonJob.get(key) ?? []), a]);
  }
  const byPerson = new Map<string, StatementLine[]>();
  for (const [key, rows] of byPersonJob) {
    const [jobId, profileId] = key.split(":");
    const gross = round2(rows.reduce((s, r) => s + r.amount, 0));
    const offset = round2(Math.min(gross, Math.max(0, paidByHand.get(key) ?? 0)));
    const line = { jobId, amount: round2(gross - offset), offset, accrualIds: rows.map((r) => r.id) };
    byPerson.set(profileId, [...(byPerson.get(profileId) ?? []), line]);
  }
  return [...byPerson.entries()]
    .map(([profileId, lines]) => ({ profileId, lines, total: round2(lines.reduce((s, l) => s + l.amount, 0)) }))
    .sort((a, b) => b.total - a.total);
}

export interface RateMismatch {
  profileId: string;
  name: string;
  /** What is on file: their own affiliate rate, or the old commission_pct when none is set. */
  onFile: number | null;
  /** Where that number came from. */
  from: "affiliate_rate" | "commission_pct" | "none";
  expected: number;
}

/**
 * Affiliates whose rate on file is not the default: the "rates on file
 * aren't 4%" finding. An explicit affiliate rate that differs is listed; so
 * is an old commission_pct that differs when no affiliate rate has been set,
 * because that number is what anybody reading the profile believes they are
 * paid. Nobody with an explicit rate equal to the default is listed.
 */
export function affiliateRateMismatches(
  people: { id: string; name: string; isAffiliate: boolean; commissionPct: number | null }[],
  ratesOnFile: ReadonlyMap<string, number>,
  defaultPct: number
): RateMismatch[] {
  const out: RateMismatch[] = [];
  for (const p of people) {
    if (!p.isAffiliate) continue;
    const explicit = ratesOnFile.get(`${p.id}:affiliate`);
    if (explicit != null) {
      if (explicit !== defaultPct) out.push({ profileId: p.id, name: p.name, onFile: explicit, from: "affiliate_rate", expected: defaultPct });
      continue;
    }
    if (p.commissionPct == null) {
      out.push({ profileId: p.id, name: p.name, onFile: null, from: "none", expected: defaultPct });
    } else if (p.commissionPct !== defaultPct) {
      out.push({ profileId: p.id, name: p.name, onFile: p.commissionPct, from: "commission_pct", expected: defaultPct });
    }
  }
  return out;
}
