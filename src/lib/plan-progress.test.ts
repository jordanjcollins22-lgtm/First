import { describe, expect, it } from "vitest";
import {
  byPlanUrgency,
  planProgress,
  plansLine,
  summarisePlans,
  type PlanLike,
  type ScheduleItem,
} from "./plan-progress";

const TODAY = new Date("2026-06-15T09:00:00.000Z");

const item = (o: Partial<ScheduleItem> & { number: number; dueOn: string }): ScheduleItem => ({
  id: `i${o.number}`,
  amountCents: 100000,
  isDeposit: false,
  status: "due",
  ...o,
});

const plan = (o: Partial<PlanLike> = {}): PlanLike => ({
  id: "p1",
  totalCents: 300000,
  paidCents: 0,
  status: "active",
  schedule: [
    item({ number: 1, dueOn: "2026-05-01" }),
    item({ number: 2, dueOn: "2026-06-01" }),
    item({ number: 3, dueOn: "2026-07-01" }),
  ],
  ...o,
});

describe("planProgress", () => {
  it("counts what is still owed and how far through it is", () => {
    const p = planProgress(plan({ paidCents: 100000 }), TODAY);
    expect(p.outstandingCents).toBe(200000);
    expect(p.fraction).toBeCloseTo(1 / 3);
  });

  it("treats an overpayment as a credit rather than a negative debt", () => {
    expect(planProgress(plan({ paidCents: 400000 }), TODAY).outstandingCents).toBe(0);
  });

  it("names the instalments that are late", () => {
    const p = planProgress(plan(), TODAY);
    expect(p.overdue.map((o) => o.number)).toEqual([1, 2]);
    expect(p.overdueCents).toBe(200000);
  });

  it("does not call one due today late", () => {
    const p = planProgress(plan({ schedule: [item({ number: 1, dueOn: "2026-06-15" })] }), TODAY);
    expect(p.overdue).toHaveLength(0);
  });

  it("still counts a failed charge as owed", () => {
    // The charge bouncing does not mean the customer stopped owing it.
    const p = planProgress(
      plan({ schedule: [item({ number: 1, dueOn: "2026-05-01", status: "failed" })] }),
      TODAY
    );
    expect(p.overdue).toHaveLength(1);
  });

  it("does not chase a cancelled instalment", () => {
    const p = planProgress(
      plan({ schedule: [item({ number: 1, dueOn: "2026-05-01", status: "cancelled" })] }),
      TODAY
    );
    expect(p.overdue).toHaveLength(0);
    expect(p.next).toBeNull();
  });

  it("points at the next one waiting", () => {
    const p = planProgress(
      plan({
        schedule: [
          item({ number: 1, dueOn: "2026-05-01", status: "paid" }),
          item({ number: 2, dueOn: "2026-07-01" }),
        ],
      }),
      TODAY
    );
    expect(p.next?.number).toBe(2);
  });

  it("calls a plan paid off settled whatever the row says", () => {
    expect(planProgress(plan({ paidCents: 300000, status: "active" }), TODAY).settled).toBe(true);
  });
});

describe("summarisePlans", () => {
  it("adds up what is still coming and what is behind", () => {
    const s = summarisePlans([plan(), plan({ id: "p2", paidCents: 300000 })], TODAY);
    expect(s.plans).toBe(2);
    expect(s.running).toBe(1);
    expect(s.behind).toBe(1);
    expect(s.owedCents).toBe(300000);
    expect(s.overdueCents).toBe(200000);
  });

  it("leaves a cancelled plan out of what is owed", () => {
    // Nobody is waiting for that money; putting it in the total promises
    // something that will never arrive.
    const s = summarisePlans([plan({ status: "cancelled" })], TODAY);
    expect(s.running).toBe(0);
    expect(s.owedCents).toBe(0);
  });
});

describe("plansLine", () => {
  it("leads with what is behind", () => {
    const line = plansLine(summarisePlans([plan()], TODAY));
    expect(line).toMatch(/\$3,000 still to come/);
    expect(line).toMatch(/1 behind by \$2,000/);
  });

  it("says so when everything is paid off", () => {
    expect(plansLine(summarisePlans([plan({ paidCents: 300000 })], TODAY))).toMatch(/paid off/i);
  });

  it("has something to say about no schedules at all", () => {
    expect(plansLine(summarisePlans([], TODAY))).toMatch(/no payment schedules/i);
  });
});

describe("byPlanUrgency", () => {
  it("puts the behind ones first and the finished ones last", () => {
    const out = byPlanUrgency(
      [
        plan({ id: "done", paidCents: 300000 }),
        plan({ id: "future", schedule: [item({ number: 1, dueOn: "2026-09-01" })] }),
        plan({ id: "behind" }),
        plan({ id: "cancelled", status: "cancelled" }),
      ],
      TODAY
    );
    expect(out.map((o) => o.id)).toEqual(["behind", "future", "done", "cancelled"]);
  });
});
