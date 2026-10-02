import { describe, expect, it } from "vitest";

import { averageRate, clockHours, counts, hoursLabel, jobRate, labourHours, roundRate, servicesToTime, type ServiceTimeLog } from "@/lib/service-timing";
import { PRODUCTION_SERVICES } from "@/lib/forward-pricing";

const log = (over: Partial<ServiceTimeLog>): ServiceTimeLog => ({
  id: "l",
  jobId: "j1",
  jobNumber: 55,
  where: null,
  zoneId: "z",
  zoneName: "Zone 1",
  serviceKey: "weed-pulling",
  unit: "SF",
  quantity: 600,
  startedAt: "2026-10-02T13:00:00Z",
  finishedAt: "2026-10-02T14:00:00Z",
  people: 2,
  excluded: false,
  by: null,
  ...over,
});

describe("how long a service took", () => {
  it("is the clock, and the clock times the people", () => {
    const l = log({ finishedAt: "2026-10-02T14:30:00Z", people: 2 });
    expect(clockHours(l)).toBe(1.5);
    expect(labourHours(l)).toBe(3);
    expect(clockHours(log({ finishedAt: null }))).toBeNull();
  });

  it("gives one job's rate for a standard crew", () => {
    // 600 sq ft in 1 hour with 2 people is 300 per person-hour: 600 per crew-hour for 2.
    expect(jobRate(log({}), 2)).toBe(600);
    // The same with 3 people is 200 per person-hour: 400 per crew-hour of 2.
    expect(jobRate(log({ people: 3 }), 2)).toBe(400);
  });
});

describe("the average across every job", () => {
  it("adds the work and the hours, so a big job weighs more than a small one", () => {
    const avg = averageRate(
      [
        log({ id: "a", jobId: "j1", quantity: 2000, finishedAt: "2026-10-02T15:00:00Z" }), // 2000 in 4 labour-hrs
        log({ id: "b", jobId: "j2", quantity: 100, finishedAt: "2026-10-02T13:06:00Z" }), // 100 in 0.2 labour-hrs
      ],
      2
    )!;
    expect(avg.jobs).toBe(2);
    expect(avg.quantity).toBe(2100);
    expect(avg.labourHours).toBeCloseTo(4.2);
    expect(avg.perLabourHour).toBeCloseTo(500);
    expect(avg.perCrewHour).toBeCloseTo(1000);
  });

  it("leaves out runs left out by the office, unfinished ones and ones with nothing done", () => {
    const logs = [log({ id: "a" }), log({ id: "b", excluded: true, quantity: 99999 }), log({ id: "c", finishedAt: null, quantity: null }), log({ id: "d", quantity: 0 })];
    expect(logs.filter(counts).map((l) => l.id)).toEqual(["a"]);
    expect(averageRate(logs, 2)!.runs).toBe(1);
    expect(averageRate([log({ excluded: true })], 2)).toBeNull();
  });

  it("counts each job once in the job count when it was timed twice", () => {
    expect(averageRate([log({ id: "a" }), log({ id: "b", zoneId: "z2" })], 2)!.jobs).toBe(1);
  });
});

describe("the services the crew time on a job", () => {
  it("lists every priced service on every area, without per-job costs or repeats", () => {
    const list = servicesToTime(
      [
        { zoneId: "z1", zoneName: "Zone 1", lines: [{ key: "weed-pulling", quantity: 1020, materialCents: 0 }, { key: "disposal", quantity: 1, materialCents: 4000 }, { key: "weed-pulling", quantity: 5, materialCents: 0 }] },
        { zoneId: "z2", zoneName: "Zone 2", lines: [{ key: "plant-removal-small", quantity: 1, materialCents: 0 }, { key: "made-up", quantity: 1, materialCents: 0 }] },
      ],
      PRODUCTION_SERVICES
    );
    expect(list.map((s) => [s.zoneName, s.key, s.plannedQuantity])).toEqual([
      ["Zone 1", "weed-pulling", 1020],
      ["Zone 2", "plant-removal-small", 1],
    ]);
  });
});

describe("numbers as people read them", () => {
  it("rounds a rate to something worth typing", () => {
    expect(roundRate(537.4)).toBe(540);
    expect(roundRate(11.6)).toBe(12);
    expect(roundRate(2.46)).toBe(2.5);
  });

  it("says hours and minutes", () => {
    expect(hoursLabel(0.75)).toBe("45 min");
    expect(hoursLabel(2)).toBe("2 hr");
    expect(hoursLabel(1 + 20 / 60)).toBe("1 hr 20 min");
  });
});
