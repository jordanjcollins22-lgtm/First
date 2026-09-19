import { describe, expect, it } from "vitest";

import { describeDbError, isMissingTable, isMissingColumn} from "./setup-errors";

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

describe("describeDbError — missing columns", () => {
  it("names the migration when a column is missing, not just a table", () => {
    // Most migrations after the first few add columns, and PostgREST reports
    // a missing column with the same "schema cache" wording. Without this the
    // app worked out that a migration was missing and then could not say
    // which — the half that was worth saying.
    const message = describeDbError({
      code: "PGRST204",
      message: "Could not find the 'contact_type' column of 'customers' in the schema cache",
    });
    expect(message).toContain("0088_contact_types.sql");
  });

  it("names the right migration for a column added later", () => {
    const message = describeDbError({
      code: "PGRST204",
      message: "Could not find the 'pipeline_stage' column of 'customers' in the schema cache",
    });
    expect(message).toContain("0089");
  });

  it("keeps the raw detail when it cannot work out which migration", () => {
    // "Run a migration, I won't say which" is the message this replaced.
    const message = describeDbError({
      code: "PGRST204",
      message: "Could not find the 'wizardry' column of 'spells' in the schema cache",
    });
    expect(message).toContain("Database setup");
    expect(message).toContain("wizardry");
  });
});

describe("describeDbError", () => {
  it("passes the database's double-booking refusal through, without its prefix", () => {
    // The trigger's message already names the person, the job and the hours.
    // Replacing it with something vaguer would throw away the only part
    // somebody can act on.
    const message = describeDbError({
      message: 'Double booking: Mike Dunn is already committed to 40 Oak Ave from X to Y.',
    });
    expect(message).toBe("Mike Dunn is already committed to 40 Oak Ave from X to Y.");
  });

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

describe("an optional column missing must not take a page down", () => {
  // The inbox and the proposals list name their columns now instead of
  // selecting everything, which is what makes them cheap — and what turned a
  // deployment part-way through its migrations from "no reference line" into
  // a crashing page. Both retry without the optional column, and this is the
  // check that decides.
  it("recognises PostgREST and Postgres saying a column is not there", () => {
    expect(isMissingColumn({ code: "PGRST204" })).toBe(true);
    expect(isMissingColumn({ code: "42703" })).toBe(true);
    expect(
      isMissingColumn({ message: "column job_messages.reference_label does not exist" })
    ).toBe(true);
    expect(
      isMissingColumn({ message: "Could not find the 'requested_via' column of 'proposal_edits'" })
    ).toBe(true);
  });

  it("does not mistake a real failure for a missing column", () => {
    // Retrying a narrower select against a dead database would just fail
    // twice and hide the reason.
    expect(isMissingColumn({ code: "PGRST301", message: "JWT expired" })).toBe(false);
    expect(isMissingColumn({ message: "permission denied for table job_messages" })).toBe(false);
    expect(isMissingColumn(null)).toBe(false);
  });
});
