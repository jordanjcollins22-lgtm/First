/**
 * The pulse of the business, judged.
 *
 * The database keeps the numbers (ops_pulse): eight weeks of evaluations,
 * proposals, wins, completed work and cash; what is on the table now; the
 * money; and what each marketing lever has brought in. This decides what
 * they mean. Four signals, each against what the business wants: are
 * enough evaluations being booked, are enough of them closing, is there
 * enough work booked ahead, is there enough cash. From the signals, the
 * problems now and the ones coming, what to work on today, and a plan: how
 * much to spend, and on which levers, the cheapest per job won first.
 *
 * Pure, because it decides where the money goes.
 */

export type LeverKey = "door_hangers" | "flyers" | "knocks" | "yard_sign" | "follow_up" | "reactivation";
export type SignalKey = "evaluations" | "closeRate" | "booked" | "cash";
export type SignalStatus = "ok" | "watch" | "bad" | "unknown";
export type RampMode = "steady" | "ramp" | "all_out";

export interface PulseWeek {
  week: string;
  evaluations: number;
  proposalsSent: number;
  sentValue: number;
  won: number;
  wonValue: number;
  lost: number;
  completed: number;
  completedValue: number;
  cashIn: number;
  cashOut: number;
}

export interface OpenProposal {
  id: string;
  jobId: string;
  customer: string;
  address: string;
  total: number | null;
  sentAt: string | null;
  daysOpen: number;
}

export interface UnwrittenEvaluation {
  jobId: string;
  customer: string;
  address: string;
  evaluatedAt: string | null;
  daysAgo: number;
}

export interface OpsPulse {
  at: string;
  weekStart: string;
  weeks: PulseWeek[];
  now: {
    scheduledAhead: number;
    scheduledNext14: number;
    proposalsOpen: OpenProposal[];
    proposalsNeedsApproval: number;
    unwritten: UnwrittenEvaluation[];
    bookedJobs: number;
    bookedValue: number;
    avgTicket: number | null;
    avgTicketAll: number | null;
    activeClients: number;
    pastClients: { customerId: string; customer: string; lastJobAt: string }[];
  };
  cash: {
    invoicesOutstanding: number;
    teamOwed: number;
    overheadMonthly: number;
    inSince: number;
    outSince: number;
    since: string;
    crewCostPerHour: number | null;
    postagePerPiece: number | null;
    printCostPerPiece: number | null;
  };
  levers: Partial<Record<LeverKey, { units: number; evaluations: number }>>;
  plays: {
    pendingApproval: number;
    open: number;
    openByKind: Partial<Record<string, number>>;
    oldestOpenDays: number;
    doneLast30: number;
    rampOpenUnits: number;
  };
}

export interface OpsTargets {
  evaluationsPerWeek: number;
  closeRate: number;
  weeksBookedAhead: number;
  cashOnHand: number | null;
  cashAsOf: string | null;
  cashFloor: number | null;
  marketingShare: number;
  autoRamp: boolean;
  leverCosts: Partial<Record<LeverKey, number>>;
}

export const DEFAULT_TARGETS: OpsTargets = {
  evaluationsPerWeek: 5,
  closeRate: 0.4,
  weeksBookedAhead: 3,
  cashOnHand: null,
  cashAsOf: null,
  cashFloor: null,
  marketingShare: 0.25,
  autoRamp: true,
  leverCosts: {},
};

/** What a job is worth to the business once the crew and materials are paid. */
export const GROSS_MARGIN = 0.4;
/** The fallback when nothing has closed yet. */
export const FALLBACK_TICKET = 2500;
/** Under this a lever is money down the drain, and the plan leaves it alone. */
const MIN_RETURN = 1.0;

export interface LeverDefinition {
  label: string;
  unit: string;
  units: string;
  /** Evaluations one unit brings, before the business's own numbers weigh in. */
  priorRate: number;
  /** How many units of the business's own results it takes to outweigh the prior. */
  priorWeight: number;
  /** Dollars a unit, all in, when the business has not said otherwise. */
  defaultCost: number;
  /** Days from doing it to the phone ringing. */
  leadDays: number;
  /** The most one round of the ramp puts out. */
  roundCap: number;
  /** Nothing smaller is worth doing. */
  minBlock: number;
  /** Staff time rather than money: always on the list, never in the budget. */
  free?: boolean;
  /** The ramp can only make plays of these; the others need a client or a person. */
  rampable?: boolean;
}

export const LEVERS: Record<LeverKey, LeverDefinition> = {
  door_hangers: { label: "Door hangers", unit: "hanger", units: "hangers", priorRate: 0.01, priorWeight: 500, defaultCost: 0.45, leadDays: 7, roundCap: 3000, minBlock: 100, rampable: true },
  knocks: { label: "Knocking on doors", unit: "door", units: "doors", priorRate: 0.08, priorWeight: 60, defaultCost: 1.5, leadDays: 3, roundCap: 200, minBlock: 5, rampable: true },
  flyers: { label: "Flyers by mail", unit: "piece", units: "pieces", priorRate: 0.003, priorWeight: 3000, defaultCost: 0.3, leadDays: 14, roundCap: 6000, minBlock: 500, rampable: true },
  yard_sign: { label: "Yard signs", unit: "sign", units: "signs", priorRate: 0.4, priorWeight: 10, defaultCost: 22, leadDays: 21, roundCap: 10, minBlock: 1 },
  follow_up: { label: "Chasing open proposals", unit: "call", units: "calls", priorRate: 0, priorWeight: 1, defaultCost: 0, leadDays: 1, roundCap: 50, minBlock: 1, free: true },
  reactivation: { label: "Texting past clients", unit: "text", units: "texts", priorRate: 0.05, priorWeight: 40, defaultCost: 0.05, leadDays: 5, roundCap: 100, minBlock: 1, free: true },
};

export const LEVER_ORDER: LeverKey[] = ["follow_up", "reactivation", "knocks", "door_hangers", "yard_sign", "flyers"];

export interface Signal {
  key: SignalKey;
  label: string;
  /** The number as shown: "3.2 / wk", "38%", "1.4 wks", "$4,200". */
  value: string;
  target: string;
  status: SignalStatus;
  /** "up", "down" or "flat" against the four weeks before. */
  trend: "up" | "down" | "flat" | null;
  why: string;
  raw: number | null;
}

export interface Todo {
  key: string;
  title: string;
  detail: string;
  href: string | null;
  severity: "bad" | "watch" | "info";
  /** Dollars at stake, for the order. */
  money: number;
}

export interface Forecast {
  key: string;
  title: string;
  detail: string;
  /** Weeks until it bites, or null when it is not going to. */
  weeksAway: number | null;
  severity: SignalStatus;
}

export interface LeverRank {
  key: LeverKey;
  label: string;
  unitCost: number;
  /** Evaluations one unit brings, the business's own numbers blended with the prior. */
  evalsPerUnit: number;
  costPerEvaluation: number | null;
  costPerJob: number | null;
  /** Dollars of margin back for each dollar spent. */
  returnPerDollar: number | null;
  /** How much of the rate is the business's own results rather than the prior. */
  confidence: "low" | "medium" | "high";
  observedUnits: number;
  observedEvaluations: number;
  leadDays: number;
  free: boolean;
  rampable: boolean;
}

export interface PlanAction {
  lever: LeverKey;
  label: string;
  units: number;
  cost: number;
  expectedEvaluations: number;
  expectedJobs: number;
  why: string;
}

export interface RampPlan {
  mode: RampMode;
  /** Dollars this round may spend. */
  budget: number;
  /** Dollars a month the cash allows, before the mode scales it. */
  allowance: number;
  actions: PlanAction[];
  /** Why the plan is what it is, in a sentence. */
  why: string;
  /** Why nothing should be made right now, when that is the case. */
  hold: string | null;
}

export interface OpsAssessment {
  signals: Signal[];
  now: Todo[];
  ahead: Forecast[];
  levers: LeverRank[];
  plan: RampPlan;
  /** Cash as the app understands it today, or null when nobody has entered it. */
  cash: number | null;
  cashFloor: number;
  weeklyBurn: number;
  closeRate: number;
  closeRateObserved: boolean;
  avgTicket: number;
  worst: SignalStatus;
}

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

function trendOf(recent: number, before: number): "up" | "down" | "flat" {
  if (before === 0 && recent === 0) return "flat";
  const change = before === 0 ? 1 : (recent - before) / before;
  return change > 0.15 ? "up" : change < -0.15 ? "down" : "flat";
}

const WORSE: Record<SignalStatus, number> = { ok: 0, unknown: 0, watch: 1, bad: 2 };

/** The status further from fine. */
export function worstOf(statuses: SignalStatus[]): SignalStatus {
  return statuses.reduce<SignalStatus>((w, s) => (WORSE[s] > WORSE[w] ? s : w), "ok");
}

/** The last four full weeks and the four before, this week left out. */
function fullWeeks(pulse: OpsPulse): { recent: PulseWeek[]; before: PulseWeek[] } {
  const weeks = pulse.weeks.slice(0, -1);
  return { recent: weeks.slice(-4), before: weeks.slice(0, -4) };
}

/** Wins over decisions in the last eight weeks; a proposal unanswered a fortnight counts as a no. */
export function closeRateOf(pulse: OpsPulse): { rate: number | null; decisions: number } {
  const won = pulse.weeks.reduce((s, w) => s + w.won, 0);
  const lost = pulse.weeks.reduce((s, w) => s + w.lost, 0);
  const stale = pulse.now.proposalsOpen.filter((p) => p.daysOpen >= 14).length;
  const decisions = won + lost + stale;
  return { rate: decisions >= 3 ? won / decisions : null, decisions };
}

/** Cash today: what was typed in, carried forward by what came in and went out since. */
export function cashToday(pulse: OpsPulse, targets: OpsTargets): number | null {
  if (targets.cashOnHand == null) return null;
  return targets.cashOnHand + pulse.cash.inSince - pulse.cash.outSince;
}

/** Overhead a week, plus what has been going out for crew, materials and the rest. */
export function weeklyBurn(pulse: OpsPulse): number {
  const { recent } = fullWeeks(pulse);
  return (pulse.cash.overheadMonthly * 12) / 52 + avg(recent.map((w) => w.cashOut));
}

/** The four signals against the targets. */
export function signalsOf(pulse: OpsPulse, targets: OpsTargets): Signal[] {
  const { recent, before } = fullWeeks(pulse);
  const signals: Signal[] = [];

  const evalsRecent = avg(recent.map((w) => w.evaluations));
  const evalsBefore = avg(before.map((w) => w.evaluations));
  const evalRatio = targets.evaluationsPerWeek > 0 ? evalsRecent / targets.evaluationsPerWeek : 1;
  signals.push({
    key: "evaluations",
    label: "Evaluations booked",
    value: `${evalsRecent.toFixed(1)} / wk`,
    target: `${targets.evaluationsPerWeek} / wk`,
    status: evalRatio >= 1 ? "ok" : evalRatio >= 0.6 ? "watch" : "bad",
    trend: trendOf(evalsRecent, evalsBefore),
    why:
      evalRatio >= 1
        ? `${evalsRecent.toFixed(1)} a week over the last four, ${pulse.now.scheduledAhead} booked ahead.`
        : `${evalsRecent.toFixed(1)} a week over the last four against ${targets.evaluationsPerWeek} wanted; ${pulse.now.scheduledAhead} booked ahead.`,
    raw: evalsRecent,
  });

  const close = closeRateOf(pulse);
  const closeRatio = close.rate == null ? null : targets.closeRate > 0 ? close.rate / targets.closeRate : 1;
  const wonRecent = recent.reduce((s, w) => s + w.won, 0);
  const wonBefore = before.reduce((s, w) => s + w.won, 0);
  signals.push({
    key: "closeRate",
    label: "Proposals closing",
    value: close.rate == null ? "—" : `${Math.round(close.rate * 100)}%`,
    target: `${Math.round(targets.closeRate * 100)}%`,
    status: closeRatio == null ? "unknown" : closeRatio >= 1 ? "ok" : closeRatio >= 0.6 ? "watch" : "bad",
    trend: close.rate == null ? null : trendOf(wonRecent, wonBefore),
    why:
      close.rate == null
        ? `Only ${close.decisions} decided in eight weeks; too few to judge.`
        : `${Math.round(close.rate * 100)}% of ${close.decisions} decided in eight weeks (a proposal unanswered a fortnight counts as a no).`,
    raw: close.rate,
  });

  const capacity = avg(recent.map((w) => w.completedValue));
  const closeForBooking = close.rate ?? targets.closeRate;
  const jobsPerWeekTarget = Math.max(0.25, targets.evaluationsPerWeek * closeForBooking);
  const weeksBooked = capacity > 0 ? pulse.now.bookedValue / capacity : pulse.now.bookedJobs / jobsPerWeekTarget;
  const bookedRatio = targets.weeksBookedAhead > 0 ? weeksBooked / targets.weeksBookedAhead : 1;
  signals.push({
    key: "booked",
    label: "Work booked ahead",
    value: `${weeksBooked.toFixed(1)} wks`,
    target: `${targets.weeksBookedAhead} wks`,
    status: bookedRatio >= 1 ? "ok" : bookedRatio >= 0.6 ? "watch" : "bad",
    trend: null,
    why:
      capacity > 0
        ? `${money(pulse.now.bookedValue)} booked against ${money(capacity)} completed a week lately.`
        : `${pulse.now.bookedJobs} job${pulse.now.bookedJobs === 1 ? "" : "s"} booked (${money(pulse.now.bookedValue)}); nothing completed lately to measure a week of work by, so counted as jobs.`,
    raw: weeksBooked,
  });

  const cash = cashToday(pulse, targets);
  const floor = targets.cashFloor ?? pulse.cash.overheadMonthly * 2;
  const burn = weeklyBurn(pulse);
  // Runway is how long the cash lasts at the rate it has been shrinking;
  // a business taking in more than it spends is not running out.
  const netWeekly = avg(recent.map((w) => w.cashIn)) - burn;
  const runway = cash == null || netWeekly >= 0 ? null : cash / -netWeekly;
  const cashStatus: SignalStatus =
    cash == null ? "unknown" : cash < floor || (runway != null && runway < 6) ? "bad" : cash < floor * 1.5 || (runway != null && runway < 10) ? "watch" : "ok";
  signals.push({
    key: "cash",
    label: "Cash",
    value: cash == null ? "—" : money(cash),
    target: `${money(floor)} floor`,
    status: cashStatus,
    trend: cash == null ? null : trendOf(avg(recent.map((w) => w.cashIn - w.cashOut)), avg(before.map((w) => w.cashIn - w.cashOut))),
    why:
      cash == null
        ? "Nobody has entered the cash on hand yet."
        : `${money(cash)} today (${money(targets.cashOnHand ?? 0)} entered, ${money(pulse.cash.inSince)} in and ${money(pulse.cash.outSince)} out since)` +
          (runway == null ? `; ${money(burn)} a week going out, covered by what comes in.` : `; shrinking ${money(-netWeekly)} a week, ${runway.toFixed(0)} weeks left.`),
    raw: cash,
  });

  return signals;
}

/** Each lever's rate, the business's own results weighed against the prior. */
export function rankLevers(pulse: OpsPulse, targets: OpsTargets, closeRate: number, avgTicket: number): LeverRank[] {
  const ranks = LEVER_ORDER.map((key): LeverRank => {
    const def = LEVERS[key];
    const seen = pulse.levers[key] ?? { units: 0, evaluations: 0 };
    const evalsPerUnit = (def.priorRate * def.priorWeight + seen.evaluations) / (def.priorWeight + seen.units);
    const share = seen.units / (seen.units + def.priorWeight);
    let unitCost = targets.leverCosts[key] ?? def.defaultCost;
    if (key === "flyers" && targets.leverCosts.flyers == null) {
      unitCost = (pulse.cash.postagePerPiece ?? 0.22) + (pulse.cash.printCostPerPiece ?? 0.08);
    }
    const costPerEvaluation = def.free || evalsPerUnit <= 0 ? null : unitCost / evalsPerUnit;
    const costPerJob = costPerEvaluation == null ? null : costPerEvaluation / Math.max(0.05, closeRate);
    const returnPerDollar = costPerJob == null || costPerJob <= 0 ? null : (avgTicket * GROSS_MARGIN) / costPerJob;
    return {
      key,
      label: def.label,
      unitCost,
      evalsPerUnit,
      costPerEvaluation,
      costPerJob,
      returnPerDollar,
      confidence: share >= 0.6 ? "high" : share >= 0.25 ? "medium" : "low",
      observedUnits: seen.units,
      observedEvaluations: seen.evaluations,
      leadDays: def.leadDays,
      free: Boolean(def.free),
      rampable: Boolean(def.rampable),
    };
  });
  // Cheapest job first; the free ones lead, because they cost nothing but time.
  return ranks.sort((a, b) => {
    if (a.free !== b.free) return a.free ? -1 : 1;
    return (a.costPerJob ?? Infinity) - (b.costPerJob ?? Infinity);
  });
}

/** Dollars a month the cash allows for marketing. */
export function allowanceOf(pulse: OpsPulse, targets: OpsTargets, cash: number | null, floor: number): number {
  if (cash != null) return Math.max(0, (cash - floor) * targets.marketingShare);
  // Nothing entered: a tenth of what has been coming in, and a floor so the
  // ramp is never nothing when the book is empty.
  const monthlyIn = avg(pulse.weeks.slice(0, -1).map((w) => w.cashIn)) * 4.33;
  return Math.max(300, monthlyIn * 0.1);
}

/** The plan: how much, on what, in what order. */
export function planOf(pulse: OpsPulse, targets: OpsTargets, signals: Signal[], levers: LeverRank[], allowance: number): RampPlan {
  const worst = worstOf(signals.map((s) => s.status));
  const mode: RampMode = worst === "bad" ? "all_out" : worst === "watch" ? "ramp" : "steady";
  const budget = Math.round(mode === "all_out" ? allowance : mode === "ramp" ? allowance * 0.5 : 0);
  const bad = signals.filter((s) => s.status === "bad").map((s) => s.label.toLowerCase());
  const watch = signals.filter((s) => s.status === "watch").map((s) => s.label.toLowerCase());
  const cashBad = signals.some((s) => s.key === "cash" && s.status === "bad");

  let hold: string | null = null;
  if (mode !== "steady") {
    if (pulse.plays.pendingApproval >= 15) hold = `${pulse.plays.pendingApproval} plays are waiting for approval; approving them comes before making more.`;
    else if (pulse.plays.open >= 30) hold = `${pulse.plays.open} marketing plays are already waiting to be done; doing them comes before making more.`;
    else if (budget < 25) hold = cashBad ? "Cash is at the floor, so the paid levers stay off; the free ones are on the list." : "The budget is too small to put anything out.";
  }

  const actions: PlanAction[] = [];
  if (mode !== "steady" && hold == null) {
    const paid = levers.filter((l) => l.rampable && !l.free && l.returnPerDollar != null && l.returnPerDollar >= MIN_RETURN && l.costPerJob != null);
    // Spend in proportion to how cheap a job is from each, then hand what is
    // left down the list, so the cheapest lever is never starved by a cap.
    const weights = paid.map((l) => 1 / (l.costPerJob as number));
    const total = weights.reduce((s, w) => s + w, 0);
    let left = budget;
    const wanted = paid.map((l, i) => Math.min(LEVERS[l.key].roundCap, Math.floor((budget * (weights[i] / total)) / Math.max(0.01, l.unitCost))));
    for (let round = 0; round < 2; round++) {
      paid.forEach((l, i) => {
        const def = LEVERS[l.key];
        const already = actions.find((a) => a.lever === l.key);
        const room = def.roundCap - (already?.units ?? 0);
        let units = round === 0 ? wanted[i] : Math.floor(left / Math.max(0.01, l.unitCost));
        units = Math.min(units, room, Math.floor(left / Math.max(0.01, l.unitCost)));
        units = Math.floor(units / def.minBlock) * def.minBlock;
        if (units < def.minBlock) return;
        const cost = Math.round(units * l.unitCost);
        left -= cost;
        const expectedEvaluations = units * l.evalsPerUnit;
        if (already) {
          already.units += units;
          already.cost += cost;
          already.expectedEvaluations += expectedEvaluations;
          already.expectedJobs += expectedEvaluations * Math.max(0.05, closeRateFor(pulse, targets));
        } else {
          actions.push({
            lever: l.key,
            label: def.label,
            units,
            cost,
            expectedEvaluations,
            expectedJobs: expectedEvaluations * Math.max(0.05, closeRateFor(pulse, targets)),
            why: `${money(l.costPerJob as number)} a job won, ${l.confidence} confidence`,
          });
        }
      });
    }
    if (actions.length === 0) hold = "No paid lever pays for itself at the current close rate; work the free ones.";
  }

  const why =
    mode === "steady"
      ? "Every signal is where it should be; the standing plays for evaluations and clients carry on."
      : mode === "ramp"
        ? `${watch.join(", ")} ${watch.length === 1 ? "is" : "are"} slipping, so half the month's allowance goes out now on the cheapest levers.`
        : `${bad.join(", ")} ${bad.length === 1 ? "is" : "are"} off target, so the whole month's allowance goes out now on the cheapest levers.`;
  return { mode, budget, allowance: Math.round(allowance), actions, why, hold };
}

function closeRateFor(pulse: OpsPulse, targets: OpsTargets): number {
  return closeRateOf(pulse).rate ?? targets.closeRate;
}

/** What is coming, and when. */
export function forecastOf(pulse: OpsPulse, targets: OpsTargets, signals: Signal[], cash: number | null, floor: number, burn: number, closeRate: number, avgTicket: number): Forecast[] {
  const out: Forecast[] = [];
  const { recent } = fullWeeks(pulse);
  const evalRate = avg(recent.map((w) => w.evaluations));
  const expectedEvals4 = Math.max(pulse.now.scheduledNext14 + evalRate * 2, evalRate * 4);
  const expectedJobs4 = expectedEvals4 * closeRate;
  const expectedRevenue4 = expectedJobs4 * avgTicket;
  const targetJobs4 = targets.evaluationsPerWeek * targets.closeRate * 4;
  out.push({
    key: "pipeline",
    title: `About ${expectedJobs4.toFixed(1)} jobs from the next four weeks of evaluations`,
    detail: `${expectedEvals4.toFixed(0)} evaluations expected (${pulse.now.scheduledNext14} already booked in the next fortnight) at ${Math.round(closeRate * 100)}% closing, ${money(expectedRevenue4)} of work.`,
    weeksAway: 4,
    severity: expectedJobs4 >= targetJobs4 ? "ok" : expectedJobs4 >= targetJobs4 * 0.6 ? "watch" : "bad",
  });

  const booked = signals.find((s) => s.key === "booked");
  const weeksBooked = booked?.raw ?? 0;
  out.push({
    key: "work",
    title: weeksBooked < 0.5 ? "The booked work is nearly done" : `Booked work runs out in about ${weeksBooked.toFixed(1)} weeks`,
    detail:
      weeksBooked >= targets.weeksBookedAhead
        ? `More than the ${targets.weeksBookedAhead} weeks wanted ahead.`
        : `Less than the ${targets.weeksBookedAhead} weeks wanted ahead; the evaluations booked now are what fills it.`,
    weeksAway: Math.round(weeksBooked),
    severity: booked?.status ?? "unknown",
  });

  if (cash != null) {
    // Week by week: burn goes out, the outstanding invoices and half the
    // expected work come in over the eight weeks.
    const inflow8 = pulse.cash.invoicesOutstanding * 0.8 + expectedRevenue4 * 0.5 * 2;
    let crosses: number | null = null;
    for (let w = 1; w <= 8; w++) {
      const projected = cash - burn * w + (inflow8 * w) / 8;
      if (projected < floor) {
        crosses = w;
        break;
      }
    }
    const cash8 = cash - burn * 8 + inflow8;
    out.push({
      key: "cash",
      title: crosses == null ? `Cash stays above the floor for the next eight weeks` : `Cash falls below the ${money(floor)} floor in about ${crosses} week${crosses === 1 ? "" : "s"}`,
      detail: `${money(cash)} now, ${money(burn)} a week out, ${money(pulse.cash.invoicesOutstanding)} invoiced and unpaid; about ${money(cash8)} in eight weeks.`,
      weeksAway: crosses,
      severity: crosses == null ? "ok" : crosses <= 4 ? "bad" : "watch",
    });
  }

  const evalSignal = signals.find((s) => s.key === "evaluations");
  if (evalSignal && evalSignal.status !== "ok") {
    out.push({
      key: "evaluations",
      title: `Evaluations are running at ${evalRate.toFixed(1)} a week against ${targets.evaluationsPerWeek} wanted`,
      detail: `At this rate the next month brings ${expectedJobs4.toFixed(1)} jobs where ${targetJobs4.toFixed(1)} are wanted. Every lever below is aimed at this.`,
      weeksAway: 2,
      severity: evalSignal.status,
    });
  }
  return out.sort((a, b) => WORSE[b.severity] - WORSE[a.severity] || (a.weeksAway ?? 99) - (b.weeksAway ?? 99));
}

/** What to work on today, the money first. */
export function todosOf(pulse: OpsPulse, targets: OpsTargets, signals: Signal[], plan: RampPlan, levers: LeverRank[], avgTicket: number): Todo[] {
  const out: Todo[] = [];
  const chase = pulse.now.proposalsOpen.filter((p) => p.daysOpen >= 3);
  if (chase.length > 0) {
    const value = chase.reduce((s, p) => s + (p.total ?? 0), 0);
    out.push({
      key: "chase",
      title: `Chase ${chase.length} proposal${chase.length === 1 ? "" : "s"} worth ${money(value)}`,
      detail: chase
        .slice(0, 3)
        .map((p) => `${p.customer} (${money(p.total ?? 0)}, ${p.daysOpen} days)`)
        .join(", ") + (chase.length > 3 ? ` and ${chase.length - 3} more` : "") + ". A call closes more than the mail ever will.",
      href: "/proposals",
      severity: chase.some((p) => p.daysOpen >= 5) ? "bad" : "watch",
      money: value,
    });
  }
  if (pulse.now.unwritten.length > 0) {
    const n = pulse.now.unwritten.length;
    out.push({
      key: "unwritten",
      title: `Write up ${n} evaluation${n === 1 ? "" : "s"} that ${n === 1 ? "has" : "have"} no proposal`,
      detail: pulse.now.unwritten
        .slice(0, 3)
        .map((u) => `${u.customer} (${u.daysAgo} days ago)`)
        .join(", ") + (n > 3 ? ` and ${n - 3} more` : "") + `. About ${money(n * avgTicket)} of work waiting to be asked for.`,
      href: "/my-day",
      severity: pulse.now.unwritten.some((u) => u.daysAgo >= 3) ? "bad" : "watch",
      money: n * avgTicket,
    });
  }
  if (pulse.now.proposalsNeedsApproval > 0) {
    out.push({
      key: "approve-proposals",
      title: `Approve ${pulse.now.proposalsNeedsApproval} proposal${pulse.now.proposalsNeedsApproval === 1 ? "" : "s"} waiting to go out`,
      detail: "A proposal nobody has approved is a job nobody has asked for.",
      href: "/proposals",
      severity: "watch",
      money: pulse.now.proposalsNeedsApproval * avgTicket * 0.5,
    });
  }
  if (pulse.plays.pendingApproval > 0) {
    out.push({
      key: "approve-plays",
      title: `Approve ${pulse.plays.pendingApproval} marketing play${pulse.plays.pendingApproval === 1 ? "" : "s"}`,
      detail: "Nothing can be ticked off until it is approved; the app learns from each one and asks less over time.",
      href: "/attractors",
      severity: pulse.plays.pendingApproval >= 10 ? "bad" : "watch",
      money: 0,
    });
  }
  if (pulse.plays.open - pulse.plays.pendingApproval > 0 && pulse.plays.oldestOpenDays >= 7) {
    out.push({
      key: "do-plays",
      title: `${pulse.plays.open - pulse.plays.pendingApproval} approved marketing play${pulse.plays.open - pulse.plays.pendingApproval === 1 ? "" : "s"} waiting to be done`,
      detail: `The oldest has waited ${pulse.plays.oldestOpenDays} days. Hangers and knocks are the cheapest evaluations there are; get them out.`,
      href: "/my-day",
      severity: pulse.plays.oldestOpenDays >= 14 ? "bad" : "watch",
      money: 0,
    });
  }
  if (targets.cashOnHand == null) {
    out.push({
      key: "enter-cash",
      title: "Enter the cash on hand",
      detail: "Without it the app cannot tell when the money runs low or how much marketing it can afford.",
      href: null,
      severity: "watch",
      money: 0,
    });
  }
  const evalSignal = signals.find((s) => s.key === "evaluations");
  if (evalSignal && evalSignal.status !== "ok" && pulse.now.pastClients.length > 0) {
    const react = levers.find((l) => l.key === "reactivation");
    const expected = pulse.now.pastClients.length * (react?.evalsPerUnit ?? 0.05);
    out.push({
      key: "reactivate",
      title: `Text ${pulse.now.pastClients.length} past client${pulse.now.pastClients.length === 1 ? "" : "s"} not heard from in four months`,
      detail: `Costs nothing and brings about ${expected.toFixed(1)} evaluation${expected >= 1.5 ? "s" : ""}; the cheapest lever there is after chasing proposals.`,
      href: "/contacts",
      severity: evalSignal.status === "bad" ? "bad" : "watch",
      money: expected * avgTicket * 0.5,
    });
  }
  for (const a of plan.actions) {
    out.push({
      key: `ramp-${a.lever}`,
      title: `${plan.mode === "all_out" ? "Ramp" : "Add"}: ${a.units.toLocaleString()} ${LEVERS[a.lever].units} for ${money(a.cost)}`,
      detail: `${a.expectedEvaluations.toFixed(1)} evaluations and ${a.expectedJobs.toFixed(1)} jobs expected; ${a.why}. ${targets.autoRamp ? "Made by the app and waiting for approval." : "Press Do it to make the plays."}`,
      href: "/attractors",
      severity: plan.mode === "all_out" ? "bad" : "watch",
      money: a.expectedJobs * avgTicket * GROSS_MARGIN,
    });
  }
  if (plan.hold && plan.mode !== "steady") {
    out.push({ key: "hold", title: "The ramp is holding", detail: plan.hold, href: null, severity: "info", money: 0 });
  }
  const rank = (t: Todo) => (t.severity === "bad" ? 2 : t.severity === "watch" ? 1 : 0);
  return out.sort((a, b) => rank(b) - rank(a) || b.money - a.money);
}

/** Everything the panel shows, from the pulse and the targets. */
export function assessOps(pulse: OpsPulse, targets: OpsTargets = DEFAULT_TARGETS): OpsAssessment {
  const signals = signalsOf(pulse, targets);
  const close = closeRateOf(pulse);
  const closeRate = close.rate ?? targets.closeRate;
  const avgTicket = pulse.now.avgTicket ?? pulse.now.avgTicketAll ?? FALLBACK_TICKET;
  const cash = cashToday(pulse, targets);
  const cashFloor = targets.cashFloor ?? pulse.cash.overheadMonthly * 2;
  const burn = weeklyBurn(pulse);
  const levers = rankLevers(pulse, targets, closeRate, avgTicket);
  const allowance = allowanceOf(pulse, targets, cash, cashFloor);
  const plan = planOf(pulse, targets, signals, levers, allowance);
  const ahead = forecastOf(pulse, targets, signals, cash, cashFloor, burn, closeRate, avgTicket);
  const now = todosOf(pulse, targets, signals, plan, levers, avgTicket);
  return {
    signals,
    now,
    ahead,
    levers,
    plan,
    cash,
    cashFloor,
    weeklyBurn: burn,
    closeRate,
    closeRateObserved: close.rate != null,
    avgTicket,
    worst: worstOf(signals.map((s) => s.status)),
  };
}

/** The plan as the database takes it. */
export function planForDatabase(plan: RampPlan): { lever: LeverKey; units: number }[] {
  return plan.actions.map((a) => ({ lever: a.lever, units: a.units }));
}

export const MODE_LABEL: Record<RampMode, string> = { steady: "Steady", ramp: "Ramping", all_out: "All out" };
export const STATUS_LABEL: Record<SignalStatus, string> = { ok: "On target", watch: "Slipping", bad: "Off target", unknown: "Not known" };
