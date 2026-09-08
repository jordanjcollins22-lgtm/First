import { describe, expect, it } from "vitest";

import { jobsInView, sortForView, viewCounts, viewOf, type BoardJob } from "./job-board";

const job = (over: Partial<BoardJob>): BoardJob => ({
  id: "j",
  jobNumber: 1,
  name: "Mulch",
  status: "approved",
  address: "1 Elm",
  customerName: "Ada",
  assignedToName: null,
  startsOn: null,
  completedAt: null,
  ...over,
});

describe("which view a job is in", () => {
  it("calls sold work upcoming, work in hand active, and finished work completed", () => {
    expect(viewOf("approved")).toBe("upcoming");
    expect(viewOf("in_progress")).toBe("active");
    expect(viewOf("completed")).toBe("completed");
  });

  it("keeps a sale out of the job board, because it is not work yet", () => {
    expect(viewOf("estimating")).toBeNull();
    expect(viewOf("quoted")).toBeNull();
  });

  it("keeps a cancelled job out of Completed, which would flatter the numbers", () => {
    expect(viewOf("cancelled")).toBeNull();
  });

  it("does not guess at a status it has never seen", () => {
    expect(viewOf("on_hold")).toBeNull();
  });
});

describe("the board", () => {
  const jobs = [
    job({ id: "a", status: "approved" }),
    job({ id: "b", status: "in_progress" }),
    job({ id: "c", status: "completed" }),
    job({ id: "d", status: "quoted" }),
    job({ id: "e", status: "cancelled" }),
  ];

  it("puts each job in exactly one view", () => {
    expect(jobsInView(jobs, "upcoming").map((j) => j.id)).toEqual(["a"]);
    expect(jobsInView(jobs, "active").map((j) => j.id)).toEqual(["b"]);
    expect(jobsInView(jobs, "completed").map((j) => j.id)).toEqual(["c"]);
  });

  it("counts what each tab holds", () => {
    expect(viewCounts(jobs)).toEqual({ upcoming: 1, active: 1, completed: 1 });
  });
});

describe("the order a view is read in", () => {
  it("leads with the soonest thing coming up", () => {
    const jobs = [
      job({ id: "late", startsOn: "2026-09-20" }),
      job({ id: "soon", startsOn: "2026-09-09" }),
    ];
    expect(sortForView(jobs, "upcoming").map((j) => j.id)).toEqual(["soon", "late"]);
  });

  it("leads with the most recently finished", () => {
    const jobs = [
      job({ id: "old", status: "completed", completedAt: "2026-08-01" }),
      job({ id: "new", status: "completed", completedAt: "2026-09-01" }),
    ];
    expect(sortForView(jobs, "completed").map((j) => j.id)).toEqual(["new", "old"]);
  });

  it("puts the unscheduled job last rather than first", () => {
    const jobs = [job({ id: "none", startsOn: null }), job({ id: "dated", startsOn: "2026-09-09" })];
    expect(sortForView(jobs, "upcoming").map((j) => j.id)).toEqual(["dated", "none"]);
  });

  it("does not reorder the array it was given", () => {
    const jobs = [job({ id: "b", startsOn: "2026-09-20" }), job({ id: "a", startsOn: "2026-09-01" })];
    sortForView(jobs, "upcoming");
    expect(jobs.map((j) => j.id)).toEqual(["b", "a"]);
  });
});
