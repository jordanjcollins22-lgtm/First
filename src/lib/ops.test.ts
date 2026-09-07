import { describe, expect, it } from "vitest";

import { assessOps, closeRateOf, DEFAULT_TARGETS, planForDatabase, rankLevers, type OpsPulse, type OpsTargets, type PulseWeek } from "./ops";

function week(over: Partial<PulseWeek> = {}): PulseWeek {
  return { week: "2026-07-06", evaluations: 5, proposalsSent: 3, sentValue: 9000, won: 2, wonValue: 6000, lost: 1, completed: 2, completedValue: 5000, cashIn: 5000, cashOut: 2500, ...over };
}

function pulse(over: Partial<OpsPulse> = {}, weekOver: Partial<PulseWeek> = {}): OpsPulse {
  return {
    at: "2026-09-07T12:00:00Z",
    weekStart: "2026-09-07",
    weeks: Array.from({ length: 8 }, () => week(weekOver)),
    now: { scheduledAhead: 4, scheduledNext14: 4, proposalsOpen: [], proposalsNeedsApproval: 0, unwritten: [], bookedJobs: 4, bookedValue: 16000, avgTicket: 3000, avgTicketAll: 3000, activeClients: 10, pastClients: [] },
    cash: { invoicesOutstanding: 2000, teamOwed: 0, overheadMonthly: 4800, inSince: 3000, outSince: 1000, since: "2026-08-31", crewCostPerHour: 100, postagePerPiece: 0.22, printCostPerPiece: 0.08 },
    levers: {},
    plays: { pendingApproval: 0, open: 3, openByKind: {}, oldestOpenDays: 2, doneLast30: 4, rampOpenUnits: 0 },
    ...over,
  };
}

const targets: OpsTargets = { ...DEFAULT_TARGETS, cashOnHand: 20000, cashAsOf: "2026-08-31" };

describe("the signals", () => {
  it("is steady when every signal is on target, and makes nothing", () => {
    const a = assessOps(pulse(), targets);
    expect(a.signals.map((s) => s.status)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(a.plan.mode).toBe("steady");
    expect(a.plan.actions).toEqual([]);
    expect(a.cash).toBe(22000);
  });
  it("goes all out when evaluations dry up, and spends the whole allowance on the cheapest levers", () => {
    const a = assessOps(pulse({}, { evaluations: 1, won: 1, lost: 1 }), targets);
    const evals = a.signals.find((s) => s.key === "evaluations");
    expect(evals?.status).toBe("bad");
    expect(a.plan.mode).toBe("all_out");
    expect(a.plan.budget).toBe(a.plan.allowance);
    expect(a.plan.actions.length).toBeGreaterThan(0);
    const spent = a.plan.actions.reduce((s, x) => s + x.cost, 0);
    expect(spent).toBeLessThanOrEqual(a.plan.budget);
    // Knocks are the cheapest job there is, so they lead; hangers follow.
    expect(a.plan.actions[0].lever).toBe("knocks");
    expect(planForDatabase(a.plan).every((x) => x.units > 0)).toBe(true);
  });
  it("ramps at half the allowance when something is only slipping", () => {
    const a = assessOps(pulse({}, { evaluations: 3.5 }), targets);
    expect(a.signals.find((s) => s.key === "evaluations")?.status).toBe("watch");
    expect(a.plan.mode).toBe("ramp");
    expect(a.plan.budget).toBe(Math.round(a.plan.allowance * 0.5));
  });
  it("does not know the cash until somebody enters it, and says so", () => {
    const a = assessOps(pulse(), DEFAULT_TARGETS);
    expect(a.signals.find((s) => s.key === "cash")?.status).toBe("unknown");
    expect(a.now.some((t) => t.key === "enter-cash")).toBe(true);
    expect(a.plan.allowance).toBeGreaterThan(0);
  });
  it("calls cash bad below the floor and keeps the paid levers off", () => {
    const a = assessOps(pulse(), { ...targets, cashOnHand: 5000, cashFloor: 9600 });
    expect(a.signals.find((s) => s.key === "cash")?.status).toBe("bad");
    expect(a.plan.mode).toBe("all_out");
    expect(a.plan.actions).toEqual([]);
    expect(a.plan.hold).toMatch(/floor/);
    expect(a.ahead.find((f) => f.key === "cash")?.severity).not.toBe("ok");
  });
  it("takes the cash from the bank when one is linked, whatever was typed", () => {
    const p = pulse({ cash: { ...pulse().cash, bankLinked: true, bankCash: 31000, bankName: "FNB" } });
    const a = assessOps(p, { ...targets, cashOnHand: 5000 });
    expect(a.cash).toBe(31000);
    expect(a.signals.find((s) => s.key === "cash")?.why).toMatch(/FNB/);
    expect(a.now.some((t) => t.key === "enter-cash")).toBe(false);
    const lapsed = assessOps(pulse({ cash: { ...pulse().cash, bankLinked: true, bankCash: 31000, bankName: "FNB", bankNeedsRelink: true } }), targets);
    expect(lapsed.now.some((t) => t.key === "relink-bank")).toBe(true);
  });
  it("counts a proposal unanswered a fortnight as a no", () => {
    const p = pulse({ now: { ...pulse().now, proposalsOpen: [{ id: "a", jobId: "j", customer: "X", address: "1 A St", total: 5000, sentAt: null, daysOpen: 20 }] } }, { won: 1, lost: 0 });
    expect(closeRateOf(p)).toEqual({ rate: 8 / 9, decisions: 9 });
  });
});

describe("the levers", () => {
  it("ranks the free levers first and then the cheapest job, using the business's own results once there are enough", () => {
    const p = pulse({ levers: { door_hangers: { units: 2000, evaluations: 60 }, flyers: { units: 100, evaluations: 0 } } });
    const ranks = rankLevers(p, targets, 0.4, 3000);
    expect(ranks[0].free).toBe(true);
    const hangers = ranks.find((l) => l.key === "door_hangers")!;
    expect(hangers.evalsPerUnit).toBeCloseTo((0.01 * 500 + 60) / 2500, 5);
    expect(hangers.confidence).toBe("high");
    expect(ranks.find((l) => l.key === "flyers")!.confidence).toBe("low");
    const paid = ranks.filter((l) => !l.free);
    for (let i = 1; i < paid.length; i++) expect(paid[i].costPerJob!).toBeGreaterThanOrEqual(paid[i - 1].costPerJob!);
  });
  it("holds the ramp while the team has a backlog of plays", () => {
    const a = assessOps(pulse({ plays: { pendingApproval: 0, open: 40, openByKind: {}, oldestOpenDays: 3, doneLast30: 0, rampOpenUnits: 0 } }, { evaluations: 1 }), targets);
    expect(a.plan.mode).toBe("all_out");
    expect(a.plan.actions).toEqual([]);
    expect(a.plan.hold).toMatch(/waiting to be done/);
  });
});

describe("what to work on now", () => {
  it("puts the money first: proposals to chase, then evaluations to write up", () => {
    const p = pulse({
      now: {
        ...pulse().now,
        proposalsOpen: [{ id: "a", jobId: "j1", customer: "Smith", address: "1 A St", total: 6300, sentAt: null, daysOpen: 5 }],
        unwritten: [{ jobId: "j2", customer: "Jones", address: "2 B St", evaluatedAt: null, daysAgo: 4 }],
        proposalsNeedsApproval: 2,
      },
    });
    const a = assessOps(p, targets);
    expect(a.now[0].key).toBe("chase");
    expect(a.now[0].title).toMatch(/\$6,300/);
    expect(a.now[1].key).toBe("unwritten");
    expect(a.now.some((t) => t.key === "approve-proposals")).toBe(true);
  });
  it("forecasts the week the cash crosses the floor", () => {
    const a = assessOps(pulse({}, { cashOut: 4000, cashIn: 0, evaluations: 0, won: 0, lost: 0 }), { ...targets, cashOnHand: 12000, cashFloor: 8000 });
    expect(a.signals.find((s) => s.key === "cash")?.status).toBe("bad");
    const cash = a.ahead.find((f) => f.key === "cash")!;
    expect(cash.weeksAway).toBeGreaterThanOrEqual(1);
    expect(cash.weeksAway).toBeLessThanOrEqual(4);
  });
});
