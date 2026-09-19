import { describe, expect, it } from "vitest";

import { busyBlocks, conflictFor, describeConflict, freeOf } from "@/lib/busy";

const AT = (h: number, m = 0) => new Date(2026, 7, 19, h, m).toISOString();
const WINDOW = (h: number, endH: number) => ({
  start: new Date(2026, 7, 19, h, 0),
  end: new Date(2026, 7, 19, endH, 0),
});

function evaluation(o: Partial<Parameters<typeof busyBlocks>[0]["evaluations"] extends (infer T)[] | undefined ? T : never> = {}) {
  return {
    jobId: "j1",
    profileId: "p1",
    startIso: AT(10),
    endIso: AT(11),
    label: "12 Elm St",
    cancelled: false,
    ...o,
  };
}

function visit(o: Partial<Parameters<typeof busyBlocks>[0]["visits"] extends (infer T)[] | undefined ? T : never> = {}) {
  return {
    jobId: "j2",
    profileIds: ["p1"],
    startsOn: "2026-08-19",
    endsOn: "2026-08-19",
    label: "40 Oak Ave",
    cancelled: false,
    ...o,
  };
}

describe("busyBlocks", () => {
  it("turns an evaluation into the window it occupies", () => {
    const [block] = busyBlocks({ evaluations: [evaluation()] });
    expect(block.source).toBe("evaluation");
    expect(block.start.getHours()).toBe(10);
    expect(block.end.getHours()).toBe(11);
  });

  it("blocks the whole crew for a work visit, not just the lead", () => {
    // The point of the whole change: a patio crew of three is three people
    // who cannot take an evaluation that morning.
    const blocks = busyBlocks({ visits: [visit({ profileIds: ["p1", "p2", "p3"] })] });
    expect(blocks.map((b) => b.profileId)).toEqual(["p1", "p2", "p3"]);
  });

  it("blocks a work visit for the whole day it is booked on", () => {
    // Visits are booked by the day. Carving out a free hour at 2pm on a job
    // day is a promise this business cannot keep.
    const [block] = busyBlocks({ visits: [visit()] });
    expect(block.start.getHours()).toBe(0);
    expect(block.end.getDate()).toBe(20);
  });

  it("covers every day of a multi-day visit", () => {
    const [block] = busyBlocks({ visits: [visit({ startsOn: "2026-08-19", endsOn: "2026-08-21" })] });
    expect(conflictFor([block], "p1", WINDOW(9, 10))).not.toBeNull();
    const thursday = { start: new Date(2026, 7, 21, 9), end: new Date(2026, 7, 21, 10) };
    expect(conflictFor([block], "p1", thursday)).not.toBeNull();
    const friday = { start: new Date(2026, 7, 22, 9), end: new Date(2026, 7, 22, 10) };
    expect(conflictFor([block], "p1", friday)).toBeNull();
  });

  it("ignores cancelled work rather than blocking a week over it", () => {
    expect(busyBlocks({ visits: [visit({ cancelled: true })] })).toEqual([]);
    expect(busyBlocks({ evaluations: [evaluation({ cancelled: true })] })).toEqual([]);
  });

  it("ignores an evaluation nobody is assigned to", () => {
    // Unassigned work blocks nobody, because there is no "them" to block.
    expect(busyBlocks({ evaluations: [evaluation({ profileId: null })] })).toEqual([]);
  });

  it("treats a day off with no times as the whole day", () => {
    const [block] = busyBlocks({
      timeOff: [{ profileId: "p1", date: "2026-08-19", startTime: null, endTime: null }],
    });
    expect(conflictFor([block], "p1", WINDOW(7, 8))).not.toBeNull();
    expect(conflictFor([block], "p1", WINDOW(20, 21))).not.toBeNull();
  });

  it("keeps a partial day off to its own hours", () => {
    const [block] = busyBlocks({
      timeOff: [{ profileId: "p1", date: "2026-08-19", startTime: "13:00", endTime: "15:00" }],
    });
    expect(conflictFor([block], "p1", WINDOW(9, 10))).toBeNull();
    expect(conflictFor([block], "p1", WINDOW(14, 15))).not.toBeNull();
  });
});

describe("conflictFor", () => {
  const blocks = busyBlocks({ evaluations: [evaluation()], visits: [visit({ jobId: "j2" })] });

  it("does not block one person with somebody else's booking", () => {
    expect(conflictFor(blocks, "p9", WINDOW(10, 11))).toBeNull();
  });

  it("lets a job be moved without its own appointment blocking it", () => {
    // Rescheduling an hour later is the most common thing anybody does on a
    // calendar, and a job that blocks itself makes that impossible.
    const evalOnly = busyBlocks({ evaluations: [evaluation()] });
    expect(conflictFor(evalOnly, "p1", WINDOW(10, 11))).not.toBeNull();
    expect(conflictFor(evalOnly, "p1", WINDOW(10, 11), "j1")).toBeNull();
  });

  it("catches an evaluation that overlaps rather than matches", () => {
    // The 10–11 booking has to block a 10:30 start, not only a 10:00 one.
    const evalOnly = busyBlocks({ evaluations: [evaluation()] });
    const half = { start: new Date(2026, 7, 19, 10, 30), end: new Date(2026, 7, 19, 11, 30) };
    expect(conflictFor(evalOnly, "p1", half)).not.toBeNull();
  });

  it("does not block a window that merely touches the end of one", () => {
    const evalOnly = busyBlocks({ evaluations: [evaluation()] });
    expect(conflictFor(evalOnly, "p1", WINDOW(11, 12))).toBeNull();
  });

  it("reports a work visit as the reason when that is what is in the way", () => {
    expect(conflictFor(blocks, "p1", WINDOW(15, 16))?.source).toBe("work_visit");
  });
});

describe("freeOf", () => {
  it("keeps only the people with nothing on", () => {
    const blocks = busyBlocks({ visits: [visit({ profileIds: ["p1"] })] });
    expect(freeOf(blocks, ["p1", "p2"], WINDOW(9, 10))).toEqual(["p2"]);
  });

  it("returns everybody when nothing is booked", () => {
    expect(freeOf([], ["p1", "p2"], WINDOW(9, 10))).toEqual(["p1", "p2"]);
  });
});

describe("describeConflict", () => {
  it("names the job rather than saying busy", () => {
    // "Not available" teaches nobody anything. Naming it is what lets somebody
    // decide whether to move this or move that.
    const [block] = busyBlocks({ visits: [visit()] });
    expect(describeConflict(block, "Mike")).toBe("Mike is on 40 Oak Ave that day.");
  });

  it("gives the time for an evaluation, since that is the part that clashes", () => {
    const [block] = busyBlocks({ evaluations: [evaluation()] });
    expect(describeConflict(block, "Mike")).toContain("12 Elm St");
    expect(describeConflict(block, "Mike")).toContain("10:00");
  });

  it("falls back to they when nobody's name was passed", () => {
    const [block] = busyBlocks({ timeOff: [{ profileId: "p1", date: "2026-08-19", startTime: null, endTime: null }] });
    expect(describeConflict(block)).toMatch(/^They're off on/);
  });
});
