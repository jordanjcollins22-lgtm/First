import { describe, expect, it } from "vitest";

import {
  averageRunDays,
  daysOfStockLeft,
  lastTakenBy,
  onHandFrom,
  runsBetweenTakeouts,
  stillOut,
  usedPerDay,
  type Movement,
} from "@/lib/inventory-usage";

let counter = 0;
function move(
  direction: Movement["direction"],
  quantity: number,
  day: string,
  personName: string | null = "Jordan"
): Movement {
  counter += 1;
  return {
    id: `m${counter}`,
    direction,
    quantity,
    personId: personName ? personName.toLowerCase() : null,
    personName,
    jobId: null,
    note: null,
    happenedAt: `${day}T09:00:00.000Z`,
  };
}

describe("onHandFrom", () => {
  it("subtracts what left and adds what came back", () => {
    const log = [move("out", 3, "2026-03-01"), move("in", 1, "2026-03-02")];
    expect(onHandFrom(log, 10)).toBe(8);
  });

  it("lets a count overrule the running total — the shelf wins", () => {
    // Two went missing without anybody scanning them out. Counting says so.
    const log = [move("out", 3, "2026-03-01"), move("count", 5, "2026-03-02")];
    expect(onHandFrom(log, 10)).toBe(5);
  });

  it("carries on from the count afterwards", () => {
    const log = [
      move("out", 3, "2026-03-01"),
      move("count", 5, "2026-03-02"),
      move("out", 2, "2026-03-03"),
    ];
    expect(onHandFrom(log, 10)).toBe(3);
  });

  it("does not care what order they arrive in", () => {
    const log = [move("in", 1, "2026-03-02"), move("out", 3, "2026-03-01")];
    expect(onHandFrom(log, 10)).toBe(8);
  });

  it("is the opening figure when nothing has moved", () => {
    expect(onHandFrom([], 4)).toBe(4);
  });
});

describe("stillOut", () => {
  it("shows what has not come back", () => {
    const log = [move("out", 1, "2026-03-01", "Mike")];
    const open = stillOut(log);
    expect(open).toHaveLength(1);
    expect(open[0].personName).toBe("Mike");
  });

  it("closes a trip when it comes back", () => {
    const log = [move("out", 1, "2026-03-01", "Mike"), move("in", 1, "2026-03-02", "Mike")];
    expect(stillOut(log)).toHaveLength(0);
  });

  it("closes the oldest trip first, which is how things come back", () => {
    const log = [
      move("out", 1, "2026-03-01", "Mike"),
      move("out", 1, "2026-03-02", "Sam"),
      move("in", 1, "2026-03-03", "Mike"),
    ];
    const open = stillOut(log);
    expect(open).toHaveLength(1);
    expect(open[0].personName).toBe("Sam");
  });

  it("splits a partial return", () => {
    const log = [move("out", 5, "2026-03-01"), move("in", 2, "2026-03-02")];
    expect(stillOut(log)[0].quantity).toBe(3);
  });

  it("leaves open trips open when somebody counts the shelf", () => {
    // A count says what is on the shelf. It says nothing about who is
    // holding the rest.
    const log = [move("out", 1, "2026-03-01", "Mike"), move("count", 4, "2026-03-02")];
    expect(stillOut(log)).toHaveLength(1);
  });

  it("is empty when nothing ever left", () => {
    expect(stillOut([move("in", 2, "2026-03-01")])).toHaveLength(0);
  });
});

describe("lastTakenBy", () => {
  it("names who had it last, even after it came back", () => {
    // The question asked when something turns up broken.
    const log = [
      move("out", 1, "2026-03-01", "Mike"),
      move("in", 1, "2026-03-02", "Mike"),
      move("out", 1, "2026-03-05", "Sam"),
      move("in", 1, "2026-03-06", "Sam"),
    ];
    expect(lastTakenBy(log)?.personName).toBe("Sam");
  });

  it("ignores returns and counts", () => {
    const log = [move("out", 1, "2026-03-01", "Mike"), move("count", 3, "2026-03-09", "Sam")];
    expect(lastTakenBy(log)?.personName).toBe("Mike");
  });

  it("is nothing when it has never left", () => {
    expect(lastTakenBy([])).toBeNull();
  });
});

describe("how long one lasts", () => {
  // The toner question: nobody records "it ran out", but everybody records
  // fitting a new one, and that dates the last one's death.
  const toner = [
    move("out", 1, "2026-01-01"),
    move("out", 1, "2026-02-01"),
    move("out", 1, "2026-03-03"),
  ];

  it("measures each one by when the next was fetched", () => {
    const runs = runsBetweenTakeouts(toner);
    expect(runs).toHaveLength(2);
    expect(runs[0].days).toBe(31);
    expect(runs[1].days).toBe(30);
  });

  it("averages them", () => {
    expect(averageRunDays(toner)).toBeCloseTo(30.5, 5);
  });

  it("does not count the one still in the machine", () => {
    // It has not ended. Counting it would drag the average down the moment
    // somebody fits a new one. Three takeouts, two finished lives.
    const runs = runsBetweenTakeouts(toner);
    expect(runs).toHaveLength(toner.length - 1);
    expect(runs[runs.length - 1].endedAt).toBe("2026-03-03T09:00:00.000Z");
  });

  it("says nothing from a single takeout", () => {
    expect(averageRunDays([move("out", 1, "2026-01-01")])).toBeNull();
    expect(runsBetweenTakeouts([move("out", 1, "2026-01-01")])).toEqual([]);
  });

  it("names who fetched each one", () => {
    const log = [move("out", 1, "2026-01-01", "Mike"), move("out", 1, "2026-02-01", "Sam")];
    expect(runsBetweenTakeouts(log)[0].personName).toBe("Mike");
  });
});

describe("how fast it goes", () => {
  it("measures across the whole span, not per trip", () => {
    // Ten bags over ten days is one a day, even though they left in twos.
    const log = [
      move("out", 2, "2026-03-01"),
      move("out", 4, "2026-03-06"),
      move("out", 6, "2026-03-11"),
    ];
    expect(usedPerDay(log)).toBe(1);
  });

  it("says nothing from one trip", () => {
    expect(usedPerDay([move("out", 5, "2026-03-01")])).toBeNull();
  });

  it("says nothing when it all happened the same day", () => {
    const log = [move("out", 2, "2026-03-01"), move("out", 3, "2026-03-01")];
    expect(usedPerDay(log)).toBeNull();
  });

  it("works out how long the shelf will last", () => {
    const log = [move("out", 2, "2026-03-01"), move("out", 8, "2026-03-05")];
    // Eight over four days is two a day; twenty left is ten days.
    expect(usedPerDay(log)).toBe(2);
    expect(daysOfStockLeft(log, 20)).toBe(10);
  });

  it("admits it does not know rather than saying forever", () => {
    expect(daysOfStockLeft([move("out", 1, "2026-03-01")], 20)).toBeNull();
  });
});
