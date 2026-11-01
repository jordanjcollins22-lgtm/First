import { describe, expect, it } from "vitest";

import type { BoardJob } from "@/lib/job-board";

import { cardForJob, planJobSync } from "./job-sync";

const job = (id: string, over: Partial<BoardJob> = {}): BoardJob => ({
  id,
  jobNumber: null,
  name: `Job ${id}`,
  status: "approved",
  address: null,
  customerName: null,
  assignedToName: null,
  startsOn: null,
  workStartsOn: null,
  completedAt: null,
  ...over,
});

describe("planJobSync", () => {
  it("adds a card for each open job without one, underway first then by start date", () => {
    const jobs = [
      job("late", { workStartsOn: "2026-11-20" }),
      job("undated"),
      job("soon", { workStartsOn: "2026-11-05" }),
      job("now", { status: "in_progress", workStartsOn: "2026-10-30" }),
      job("done", { status: "completed" }),
      job("quote", { status: "quoted" }),
      job("declined", { declined: true }),
    ];
    const { toAdd } = planJobSync(jobs, []);
    expect(toAdd.map((c) => c.job_id)).toEqual(["now", "soon", "late", "undated"]);
  });

  it("never adds a second card for a job", () => {
    const { toAdd } = planJobSync([job("a")], [{ id: "c1", job_id: "a", stage: "answer" }]);
    expect(toAdd).toEqual([]);
  });

  it("drops Backlog cards for jobs no longer open, and keeps cards already being worked", () => {
    const cards = [
      { id: "c1", job_id: "done", stage: "backlog" as const },
      { id: "c2", job_id: "cancelled", stage: "breakdown" as const },
      { id: "c3", job_id: "open", stage: "backlog" as const },
    ];
    const { toRemove } = planJobSync([job("done", { status: "completed" }), job("open")], cards);
    expect(toRemove).toEqual(["c1"]);
  });
});

describe("cardForJob", () => {
  it("names the job, the client and the start day", () => {
    const card = cardForJob(
      job("a", { jobNumber: 78, name: "Front beds", customerName: "Michael Dembeck", address: "1 Oak St", workStartsOn: "2026-11-05", assignedToName: "Jack" })
    );
    expect(card).toEqual({
      job_id: "a",
      title: "#78 Front beds",
      asked_by: "Michael Dembeck",
      details: "1 Oak St\nStarts Nov 5\nAssigned to Jack",
      backlog_group: "External",
    });
  });
});
