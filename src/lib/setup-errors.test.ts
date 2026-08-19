import { describe, expect, it } from "vitest";

import { describeDbError, isMissingTable } from "@/lib/setup-errors";

describe("isMissingTable", () => {
  it("recognises the PostgREST schema-cache answer", () => {
    expect(
      isMissingTable({ message: "Could not find the table 'public.job_crew' in the schema cache" })
    ).toBe(true);
  });

  it("recognises it by code", () => {
    expect(isMissingTable({ code: "PGRST205" })).toBe(true);
    expect(isMissingTable({ code: "42P01" })).toBe(true);
  });

  it("recognises the raw Postgres wording", () => {
    expect(isMissingTable({ message: 'relation "job_crew" does not exist' })).toBe(true);
  });

  it("does not claim a real failure is a missing table", () => {
    expect(isMissingTable({ message: "duplicate key value violates unique constraint" })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
  });
});

describe("describeDbError", () => {
  it("names the migration that creates the missing table", () => {
    const message = describeDbError({
      message: "Could not find the table 'public.job_crew' in the schema cache",
    });
    expect(message).toContain("0083_job_crew.sql");
    expect(message).toContain("SQL Editor");
  });

  it("names the right migration for a different table", () => {
    expect(
      describeDbError({ message: "Could not find the table 'public.job_walkthroughs' in the schema cache" })
    ).toContain("0081_final_walkthrough.sql");
  });

  it("still helps when it cannot work out which table", () => {
    const message = describeDbError({ code: "PGRST205", message: "Could not find the table" });
    expect(message).toMatch(/database migration/i);
  });

  it("passes a genuine failure through rather than dressing it up as setup", () => {
    // A real error reported as "run the migration" sends somebody hunting for
    // a problem that isn't there.
    expect(describeDbError({ message: "new row violates row-level security policy" })).toBe(
      "new row violates row-level security policy"
    );
  });

  it("falls back when there is no error at all", () => {
    expect(describeDbError(null, "Couldn't do that.")).toBe("Couldn't do that.");
  });
});
