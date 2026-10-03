import { describe, expect, it } from "vitest";

import {
  firstTimeDoors,
  nextDesign,
  printRun,
  totalToPrint,
  type HouseVisit,
} from "@/lib/hanger-design";

function doors(...hangCounts: number[]): HouseVisit[] {
  return hangCounts.map((hangCount, i) => ({ houseId: `h${i}`, hangCount }));
}

describe("nextDesign", () => {
  it("gives a new door the introduction", () => {
    expect(nextDesign(0, 3)).toBe(1);
  });

  it("escalates by one per hanger already delivered", () => {
    expect(nextDesign(1, 3)).toBe(2);
    expect(nextDesign(2, 3)).toBe(3);
  });

  it("stops at the last design that exists rather than asking for one that does not", () => {
    expect(nextDesign(5, 3)).toBe(3);
    expect(nextDesign(50, 3)).toBe(3);
  });

  it("always has a design 1, even with no artwork uploaded", () => {
    // A missing file must not stop the walk.
    expect(nextDesign(0, 0)).toBe(1);
    expect(nextDesign(4, 0)).toBe(1);
  });

  it("treats a nonsense count as a door never visited", () => {
    expect(nextDesign(-3, 3)).toBe(1);
  });

  it("ignores a fractional count rather than printing design 1.5", () => {
    expect(nextDesign(1.7, 3)).toBe(2);
    expect(Number.isInteger(nextDesign(2.4, 5))).toBe(true);
  });
});

describe("printRun", () => {
  it("counts how many of each design the walk needs", () => {
    expect(printRun(doors(0, 0, 1, 2), 3)).toEqual([
      { design: 1, count: 2 },
      { design: 2, count: 1 },
      { design: 3, count: 1 },
    ]);
  });

  it("is ordered by design, so the run reads as a stack to print", () => {
    const run = printRun(doors(2, 0, 1, 0, 2), 3);
    expect(run.map((line) => line.design)).toEqual([1, 2, 3]);
  });

  it("leaves out designs nothing needs rather than printing a zero", () => {
    // A zero on a print sheet reads as a mistake to whoever is at the printer.
    const run = printRun(doors(0, 0, 0), 4);
    expect(run).toEqual([{ design: 1, count: 3 }]);
  });

  it("piles well-worked doors onto the last design", () => {
    expect(printRun(doors(9, 9, 9), 2)).toEqual([{ design: 2, count: 3 }]);
  });

  it("prints nothing for a walk with no doors", () => {
    expect(printRun([], 3)).toEqual([]);
  });

  it("adds up to one hanger per door", () => {
    const houses = doors(0, 1, 1, 2, 7, 0);
    const printed = printRun(houses, 3).reduce((sum, line) => sum + line.count, 0);
    expect(printed).toBe(houses.length);
  });
});

describe("totalToPrint", () => {
  it("is one per door", () => {
    expect(totalToPrint(doors(0, 1, 4))).toBe(3);
  });

  it("is nothing for an empty walk", () => {
    expect(totalToPrint([])).toBe(0);
  });
});

describe("firstTimeDoors", () => {
  it("counts the doors that have never had one", () => {
    expect(firstTimeDoors(doors(0, 0, 1, 3))).toBe(2);
  });

  it("is zero on a street already being worked", () => {
    expect(firstTimeDoors(doors(1, 2, 3))).toBe(0);
  });

  it("is all of them on new ground", () => {
    expect(firstTimeDoors(doors(0, 0, 0))).toBe(3);
  });
});
