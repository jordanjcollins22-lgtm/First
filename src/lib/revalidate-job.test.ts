import { describe, expect, it } from "vitest";

import { JOB_STATUS_PATHS } from "./revalidate-job";

describe("the screens a job's status is read from", () => {
  it("includes the pipeline", () => {
    // The one that started this. A client signed their proposal, the job and
    // the proposals list updated, and the pipeline card sat in the old column
    // looking exactly like a status that had not saved.
    expect(JOB_STATUS_PATHS).toContain("/pipeline");
  });

  it("includes the dashboard, which buckets off the same statuses", () => {
    expect(JOB_STATUS_PATHS).toContain("/dashboard");
    expect(JOB_STATUS_PATHS).toContain("/");
  });

  it("includes the proposals list and the day screens", () => {
    expect(JOB_STATUS_PATHS).toContain("/proposals");
    expect(JOB_STATUS_PATHS).toContain("/my-day");
    expect(JOB_STATUS_PATHS).toContain("/evaluations");
  });

  it("lists each path once", () => {
    expect(new Set(JOB_STATUS_PATHS).size).toBe(JOB_STATUS_PATHS.length);
  });

  it("names absolute paths, since a relative one silently matches nothing", () => {
    for (const path of JOB_STATUS_PATHS) {
      expect(path.startsWith("/"), path).toBe(true);
    }
  });
});
