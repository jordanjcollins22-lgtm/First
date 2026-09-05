/**
 * How a customer pays: all at once, in instalments, or on a subscription.
 *
 * Everything here works in whole cents. A quote of £1,234.56 split three ways
 * is not three payments of 411.52 — it is 411.52, 411.52 and 411.52 with a
 * penny left over, and a penny left over is a customer who is never quite
 * paid off. So the split is done in cents and the remainder is placed
 * deliberately rather than rounded away.
 */

export type PlanKind = "one_time" | "instalments" | "subscription";

export type Interval = "weekly" | "monthly" | "quarterly" | "yearly";

export const INTERVALS: { value: Interval; label: string; days: number }[] = [
  { value: "weekly", label: "Weekly", days: 7 },
  { value: "monthly", label: "Monthly", days: 30 },
  { value: "quarterly", label: "Every 3 months", days: 91 },
  { value: "yearly", label: "Yearly", days: 365 },
];

/** Money in, always. Floats are for measurements, not for what somebody owes. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export interface PlanInput {
  /** The whole job, in cents. */
  totalCents: number;
  kind: PlanKind;
  /** Taken up front, before the rest is split. Cents. */
  depositCents?: number;
  /** How many payments the rest is split into. Instalments only. */
  instalments?: number;
  interval?: Interval;
}

export interface Instalment {
  /** 1-based, the way somebody counts them. */
  number: number;
  amountCents: number;
  /** Days from acceptance. The first is 0 — a deposit is due now. */
  dueInDays: number;
  isDeposit: boolean;
}

/**
 * Checks a plan before anybody is asked to accept it.
 *
 * Refused rather than corrected: a plan that quietly became something other
 * than what was typed is a plan somebody agreed to without reading.
 */
export function checkPlan(input: PlanInput): { ok: true } | { ok: false; reason: string } {
  if (!Number.isInteger(input.totalCents) || input.totalCents <= 0) {
    return { ok: false, reason: "The total has to be more than nothing." };
  }

  const deposit = input.depositCents ?? 0;
  if (deposit < 0) return { ok: false, reason: "A deposit cannot be negative." };
  if (deposit > input.totalCents) {
    return { ok: false, reason: "The deposit is more than the whole job." };
  }

  if (input.kind === "instalments") {
    const count = input.instalments ?? 0;
    if (!Number.isInteger(count) || count < 1) {
      return { ok: false, reason: "How many payments?" };
    }
    if (count > 60) {
      return { ok: false, reason: "That is more payments than anybody wants to chase." };
    }
    if (deposit === input.totalCents) {
      return { ok: false, reason: "The deposit covers it — that is a one-off, not a plan." };
    }
    if (!input.interval) return { ok: false, reason: "How often?" };
  }

  if (input.kind === "subscription") {
    if (!input.interval) return { ok: false, reason: "How often?" };
    if (deposit > 0) {
      return { ok: false, reason: "A subscription bills the same amount each time — no deposit." };
    }
  }

  return { ok: true };
}

/**
 * The payments, in order, adding up to exactly the total.
 *
 * The remainder from the division goes onto the earliest payments rather than
 * the last, so the odd penny arrives soonest and the final payment is the
 * round one. Either choice is defensible; what is not defensible is losing it.
 */
export function buildSchedule(input: PlanInput): Instalment[] {
  const verdict = checkPlan(input);
  if (!verdict.ok) return [];

  const deposit = input.depositCents ?? 0;
  const schedule: Instalment[] = [];

  if (deposit > 0) {
    schedule.push({ number: 1, amountCents: deposit, dueInDays: 0, isDeposit: true });
  }

  if (input.kind === "one_time") {
    const rest = input.totalCents - deposit;
    if (rest > 0) {
      schedule.push({
        number: schedule.length + 1,
        amountCents: rest,
        dueInDays: 0,
        isDeposit: false,
      });
    }
    return schedule;
  }

  if (input.kind === "subscription") {
    // Open-ended by nature: what recurs is one amount, not a list with an end.
    return [
      {
        number: 1,
        amountCents: input.totalCents,
        dueInDays: 0,
        isDeposit: false,
      },
    ];
  }

  const count = input.instalments ?? 1;
  const rest = input.totalCents - deposit;
  const each = Math.floor(rest / count);
  let remainder = rest - each * count;
  const days = INTERVALS.find((i) => i.value === input.interval)?.days ?? 30;

  for (let i = 0; i < count; i++) {
    // One extra penny each until the remainder is gone.
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;

    schedule.push({
      number: schedule.length + 1,
      amountCents: each + extra,
      // The first instalment falls one interval after acceptance; a deposit,
      // if there is one, is what covers today.
      dueInDays: days * (i + 1),
      isDeposit: false,
    });
  }

  return schedule;
}

/** What the schedule adds up to. Should always equal the total. */
export function scheduleTotal(schedule: Instalment[]): number {
  return schedule.reduce((sum, item) => sum + item.amountCents, 0);
}

/** How it reads to the person being asked to agree to it. */
export function describePlan(input: PlanInput): string {
  const verdict = checkPlan(input);
  if (!verdict.ok) return verdict.reason;

  const money = (cents: number) =>
    (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });

  const deposit = input.depositCents ?? 0;
  const intervalLabel = INTERVALS.find((i) => i.value === input.interval)?.label.toLowerCase();

  if (input.kind === "one_time") {
    return `${money(input.totalCents)} in full.`;
  }

  if (input.kind === "subscription") {
    return `${money(input.totalCents)}, ${intervalLabel}, until it is cancelled.`;
  }

  const schedule = buildSchedule(input).filter((item) => !item.isDeposit);
  const first = schedule[0]?.amountCents ?? 0;
  const last = schedule[schedule.length - 1]?.amountCents ?? 0;
  const amounts = first === last ? money(first) : `${money(first)} then ${money(last)}`;

  const depositPart = deposit > 0 ? `${money(deposit)} down, then ` : "";
  return `${depositPart}${schedule.length} payments of ${amounts}, ${intervalLabel}.`;
}

export interface Paid {
  amountCents: number;
}

/** What is still owed. Never negative — an overpayment is a credit, not a debt. */
export function outstandingCents(totalCents: number, paid: Paid[]): number {
  const settled = paid.reduce((sum, payment) => sum + payment.amountCents, 0);
  return Math.max(0, totalCents - settled);
}

/** Whether the job is paid off. */
export function isSettled(totalCents: number, paid: Paid[]): boolean {
  return outstandingCents(totalCents, paid) === 0;
}
