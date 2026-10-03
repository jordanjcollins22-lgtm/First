import { describe, expect, it } from "vitest";

import { formatJobNumber, jobLabel, parseJobNumber } from "@/lib/job-number";

describe("formatJobNumber", () => {
  it("pads so a column of them lines up", () => {
    // Job 42 and job 4200 should not be mistaken for each other at a glance.
    expect(formatJobNumber(42)).toBe("#0042");
    expect(formatJobNumber(4200)).toBe("#4200");
  });

  it("grows rather than truncating past four digits", () => {
    expect(formatJobNumber(12345)).toBe("#12345");
  });

  it("has nothing to show for a job written before numbering existed", () => {
    expect(formatJobNumber(null)).toBeNull();
  });

  it("refuses nonsense rather than printing it", () => {
    expect(formatJobNumber(-1)).toBeNull();
    expect(formatJobNumber(Number.NaN)).toBeNull();
  });
});

describe("jobLabel", () => {
  it("leads with the address, because that is what everybody calls it", () => {
    expect(jobLabel(1042, "208 Crafton Rd", "Front beds")).toBe("208 Crafton Rd · #1042");
  });

  it("falls back to the job's name when there is no address", () => {
    expect(jobLabel(7, null, "Front beds")).toBe("Front beds · #0007");
  });

  it("still says something for an unnumbered job", () => {
    expect(jobLabel(null, "208 Crafton Rd", "Front beds")).toBe("208 Crafton Rd");
  });

  it("never renders an empty label", () => {
    expect(jobLabel(null, "  ", "  ")).toBe("Job");
  });
});

describe("parseJobNumber", () => {
  it("accepts the three ways people type it", () => {
    // A search box that only takes one of them is one people stop using.
    expect(parseJobNumber("1042")).toBe(1042);
    expect(parseJobNumber("#1042")).toBe(1042);
    expect(parseJobNumber("job 1042")).toBe(1042);
  });

  it("ignores a search that is plainly a name", () => {
    expect(parseJobNumber("Crafton")).toBeNull();
  });

  it("does not read a house number out of an address", () => {
    // "208 Crafton Rd" is a place, not job 208.
    expect(parseJobNumber("208 Crafton Rd")).toBeNull();
  });

  it("refuses zero, which is not a job", () => {
    expect(parseJobNumber("0")).toBeNull();
  });
});
