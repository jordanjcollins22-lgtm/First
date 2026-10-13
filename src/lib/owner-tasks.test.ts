import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { countTasks, seedValuesSql, sortTasks, TASK_SEED, toggledStatus } from "./owner-tasks";

const root = join(__dirname, "..", "..");

describe("TASK_SEED", () => {
  // The list moved out of the browser and into owner_tasks; the seed is now
  // the only copy, so it is checked against the migration that loads it.
  it("carries the 33 items of the old v2 Task list", () => {
    expect(TASK_SEED).toHaveLength(33);
  });

  it("matches the seed migration exactly", () => {
    const sql = readFileSync(join(root, "supabase/migrations/0356b_owner_tasks_seed.sql"), "utf8");
    expect(sql).toContain(seedValuesSql());
  });
});

describe("sortTasks and countTasks", () => {
  it("orders by page, then position", () => {
    const sorted = sortTasks([
      { section: "Other", position: 1, title: "b" },
      { section: "Admin", position: 2, title: "a" },
      { section: "Marketing", position: 5, title: "z" },
      { section: "Admin", position: 1, title: "c" },
    ]);
    expect(sorted.map((t) => `${t.section}:${t.title}`)).toEqual(["Marketing:z", "Admin:c", "Admin:a", "Other:b"]);
  });
  it("counts what is open and done", () => {
    expect(countTasks([{ status: "not_built" }, { status: "partly_built" }, { status: "done" }, { status: "dropped" }, { status: "todo" }])).toEqual({
      notBuilt: 1,
      partlyBuilt: 1,
      open: 3,
      done: 1,
    });
  });
});

describe("toggledStatus", () => {
  it("ticks to done, and un-ticks back to where it was", () => {
    expect(toggledStatus("partly_built", null)).toBe("done");
    expect(toggledStatus("done", "partly_built")).toBe("partly_built");
    expect(toggledStatus("done", null)).toBe("todo");
  });
});
