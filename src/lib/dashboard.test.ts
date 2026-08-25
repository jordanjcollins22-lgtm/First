import { describe, expect, it } from "vitest";

import {
  buildDashboard,
  dayKeyOf,
  evaluationBucket,
  isTheirs,
  jobBucket,
  windowFor,
  type DashboardJobInput,
} from "@/lib/dashboard";

// A Wednesday, so the week window has days either side of it.
const TODAY = new Date(2026, 7, 19, 9, 0, 0);

function job(overrides: Partial<DashboardJobInput> = {}): DashboardJobInput {
  return {
    id: "j1",
    jobNumber: 1,
    jobName: "Front beds",
    customerName: "Pat Rivera",
    address: "208 Crafton Rd",
    status: "estimating",
    evaluationStatus: "scheduled",
    evaluationDate: null,
    projectStartDate: null,
    projectEndDate: null,
    completedAt: null,
    cancelledAt: null,
    proposalStatus: null,
    value: null,
    personName: "Mike",
    ...overrides,
  };
}

function rows(data: ReturnType<typeof buildDashboard>, half: "evaluations" | "jobs", key: string) {
  return data[half].find((s) => s.key === key)!.rows;
}

describe("windowFor", () => {
  it("makes today a single day", () => {
    expect(windowFor("today", TODAY)).toMatchObject({ start: "2026-08-19", end: "2026-08-19" });
  });

  it("runs the week Monday to Sunday around today", () => {
    expect(windowFor("week", TODAY)).toMatchObject({ start: "2026-08-17", end: "2026-08-23" });
  });

  it("starts the week on Monday even when today is Sunday", () => {
    // The off-by-one that puts Sunday in next week, which is the day somebody
    // would actually notice.
    expect(windowFor("week", new Date(2026, 7, 23))).toMatchObject({
      start: "2026-08-17",
      end: "2026-08-23",
    });
  });

  it("covers the whole calendar month", () => {
    expect(windowFor("month", TODAY)).toMatchObject({ start: "2026-08-01", end: "2026-08-31" });
  });
});

describe("dayKeyOf", () => {
  it("leaves a plain date alone rather than reparsing it as an instant", () => {
    // Reparsing is what shifts a work date back a day west of Greenwich.
    expect(dayKeyOf("2026-08-19")).toBe("2026-08-19");
  });

  it("files a timestamp under the local day it happens on", () => {
    const evening = new Date(2026, 7, 19, 20, 30).toISOString();
    expect(dayKeyOf(evening)).toBe("2026-08-19");
  });

  it("says nothing rather than guessing when there is no date", () => {
    expect(dayKeyOf(null)).toBeNull();
  });
});

describe("evaluationBucket", () => {
  it("has no opinion about a job with no visit booked", () => {
    expect(evaluationBucket(job())).toBeNull();
  });

  it("reads the evaluator's own status", () => {
    const at = "2026-08-19T13:00:00Z";
    expect(evaluationBucket(job({ evaluationDate: at, evaluationStatus: "on_way" }))).toBe("on_way");
    expect(evaluationBucket(job({ evaluationDate: at, evaluationStatus: "arrived" }))).toBe("arrived");
    expect(evaluationBucket(job({ evaluationDate: at, evaluationStatus: "completed" }))).toBe("completed");
  });

  it("cancels the visit when the job itself is cancelled", () => {
    // Otherwise a called-off job sits in "Evaluated" looking like it needs
    // pricing.
    const cancelled = job({
      evaluationDate: "2026-08-19T13:00:00Z",
      evaluationStatus: "completed",
      status: "cancelled",
    });
    expect(evaluationBucket(cancelled)).toBe("cancelled");
  });
});

describe("jobBucket", () => {
  const today = "2026-08-19";

  it("leaves a job that is still being evaluated off the work half", () => {
    expect(jobBucket(job(), today)).toBeNull();
  });

  it("calls sold work with no days on the calendar what it is", () => {
    expect(jobBucket(job({ status: "approved" }), today)).toBe("unscheduled");
  });

  it("counts an accepted proposal as sold even before the status catches up", () => {
    expect(jobBucket(job({ proposalStatus: "accepted" }), today)).toBe("unscheduled");
  });

  it("shows a priced job as out for a decision", () => {
    expect(jobBucket(job({ status: "quoted", proposalStatus: "sent" }), today)).toBe("quoting");
  });

  it("books sold work that has days", () => {
    const booked = job({ status: "approved", projectStartDate: "2026-08-20", projectEndDate: "2026-08-21" });
    expect(jobBucket(booked, today)).toBe("scheduled");
  });

  it("flags work whose window has passed with nobody closing it", () => {
    // The one that disappears in practice: the crew drove away and the job
    // sits in progress forever because closing it was nobody's next task.
    const overran = job({ status: "in_progress", projectStartDate: "2026-08-10", projectEndDate: "2026-08-12" });
    expect(jobBucket(overran, today)).toBe("needs_signoff");
  });

  it("flags a booked job that never started and is already past", () => {
    const missed = job({ status: "approved", projectStartDate: "2026-08-10", projectEndDate: "2026-08-11" });
    expect(jobBucket(missed, today)).toBe("needs_signoff");
  });

  it("keeps a job in progress on its last day rather than calling it late", () => {
    const running = job({ status: "in_progress", projectStartDate: "2026-08-18", projectEndDate: today });
    expect(jobBucket(running, today)).toBe("working");
  });

  it("puts cancelled and completed ahead of everything else", () => {
    expect(jobBucket(job({ status: "cancelled", proposalStatus: "accepted" }), today)).toBe("cancelled");
    expect(jobBucket(job({ status: "completed" }), today)).toBe("completed");
  });
});

describe("buildDashboard", () => {
  it("keeps an outstanding visit from last week on today's screen, flagged", () => {
    // A visit nobody made on Tuesday does not stop mattering on Wednesday.
    const data = buildDashboard(
      [job({ evaluationDate: "2026-08-11T13:00:00Z", evaluationStatus: "scheduled" })],
      "today",
      TODAY
    );
    expect(rows(data, "evaluations", "scheduled")).toHaveLength(1);
    expect(rows(data, "evaluations", "scheduled")[0].overdue).toBe(true);
    expect(data.summary.overdue).toBe(1);
  });

  it("leaves a finished visit on its own day instead of carrying it forward", () => {
    const data = buildDashboard(
      [job({ evaluationDate: "2026-08-11T13:00:00Z", evaluationStatus: "completed" })],
      "today",
      TODAY
    );
    expect(rows(data, "evaluations", "completed")).toEqual([]);
  });

  it("shows a job whose window spans today even though neither date is today", () => {
    const spanning = job({
      status: "in_progress",
      projectStartDate: "2026-08-17",
      projectEndDate: "2026-08-21",
    });
    expect(rows(buildDashboard([spanning], "today", TODAY), "jobs", "working")).toHaveLength(1);
  });

  it("always shows sold-but-unbooked work, whatever window is picked", () => {
    // It has no date to filter on, and it is exactly the work that goes quiet.
    const data = buildDashboard([job({ status: "approved" })], "today", TODAY);
    expect(rows(data, "jobs", "unscheduled")).toHaveLength(1);
  });

  it("always shows work waiting on a sign-off, however old", () => {
    const old = job({ status: "in_progress", projectStartDate: "2026-06-01", projectEndDate: "2026-06-02" });
    const data = buildDashboard([old], "today", TODAY);
    expect(rows(data, "jobs", "needs_signoff")).toHaveLength(1);
    expect(data.summary.needsSignoff).toBe(1);
  });

  it("files a finished job under the day it was signed off", () => {
    const done = job({
      status: "completed",
      completedAt: "2026-08-19T22:00:00Z",
      projectEndDate: "2026-07-01",
    });
    expect(rows(buildDashboard([done], "today", TODAY), "jobs", "completed")).toHaveLength(1);
    expect(rows(buildDashboard([done], "month", new Date(2026, 6, 15)), "jobs", "completed")).toEqual([]);
  });

  it("counts booked value from work in the window only", () => {
    const jobs = [
      job({ id: "a", status: "in_progress", projectStartDate: "2026-08-19", value: 2000 }),
      job({ id: "b", status: "approved", projectStartDate: "2026-12-01", value: 9000 }),
    ];
    expect(buildDashboard(jobs, "today", TODAY).summary.bookedValue).toBe(2000);
  });

  it("widens with the window rather than re-sorting the same rows", () => {
    const nextDay = job({ status: "approved", projectStartDate: "2026-08-20", projectEndDate: "2026-08-20" });
    expect(rows(buildDashboard([nextDay], "today", TODAY), "jobs", "scheduled")).toEqual([]);
    expect(rows(buildDashboard([nextDay], "week", TODAY), "jobs", "scheduled")).toHaveLength(1);
  });

  it("orders a pile by date with undated rows last", () => {
    const jobs = [
      job({ id: "late", status: "approved", projectStartDate: "2026-08-21" }),
      job({ id: "early", status: "approved", projectStartDate: "2026-08-19" }),
    ];
    const scheduled = rows(buildDashboard(jobs, "week", TODAY), "jobs", "scheduled");
    expect(scheduled.map((r) => r.jobId)).toEqual(["early", "late"]);
  });

  it("carries the job number onto the row, since that is what gets said aloud", () => {
    const data = buildDashboard(
      [job({ jobNumber: 1042, status: "in_progress", projectStartDate: "2026-08-19" })],
      "today",
      TODAY
    );
    expect(rows(data, "jobs", "working")[0].jobNumber).toBe(1042);
  });

  it("returns every pile even when empty, so the shape of the day is visible", () => {
    const data = buildDashboard([], "today", TODAY);
    expect(data.evaluations).toHaveLength(5);
    expect(data.jobs).toHaveLength(7);
    expect(data.summary).toEqual({
      evaluationsDue: 0,
      overdue: 0,
      jobsOnSite: 0,
      needsSignoff: 0,
      bookedValue: 0,
    });
  });
});

describe("isTheirs", () => {
  it("counts every job on a client they manage", () => {
    expect(isTheirs({ accountManagerId: "me", assignedTo: "someone-else" }, "me")).toBe(true);
  });

  it("counts a job they were assigned on somebody else's client", () => {
    // They are still expected at that appointment. Leaving it off their day
    // would be lying by omission.
    expect(isTheirs({ accountManagerId: "other", assignedTo: "me" }, "me")).toBe(true);
  });

  it("leaves out a job that is neither", () => {
    expect(isTheirs({ accountManagerId: "other", assignedTo: "other" }, "me")).toBe(false);
  });

  it("does not treat an unmanaged client as everybody's", () => {
    expect(isTheirs({ accountManagerId: null, assignedTo: null }, "me")).toBe(false);
  });
});
