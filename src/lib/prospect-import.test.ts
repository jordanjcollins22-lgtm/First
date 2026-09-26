import { describe, expect, it } from "vitest";

import {
  applyTargetFilter,
  dedupeDrafts,
  importCsv,
  parseCsv,
} from "@/lib/prospect-import";

describe("parseCsv", () => {
  it("reads quoted fields containing commas", () => {
    const rows = parseCsv('Address,Owner\n"123 Main St, Bel Air","Smith, John"');
    expect(rows[1]).toEqual(["123 Main St, Bel Air", "Smith, John"]);
  });

  it("handles escaped quotes and blank lines", () => {
    const rows = parseCsv('A\n"He said ""hi"""\n\n');
    expect(rows[1][0]).toBe('He said "hi"');
    expect(rows).toHaveLength(2);
  });
});

describe("importCsv", () => {
  it("maps a county-style export", () => {
    const csv = [
      "Owner Name,Property Address,City,State,Zip,Deed Acres,Total Assessment",
      '"Johnson, Mike",123 Main St,Bel Air,MD,21014,1.25,"$425,000"',
    ].join("\n");

    const report = importCsv(csv);
    expect(report.drafts).toHaveLength(1);
    expect(report.drafts[0]).toMatchObject({
      ownerName: "Johnson, Mike",
      address: "123 Main St",
      city: "Bel Air",
      zip: "21014",
      acreage: 1.25,
      assessedValue: 425000,
    });
  });

  it("maps a vendor list with different headers", () => {
    const csv = ["owner,site address,phone,email,lot size acres", "Pat Cole,9 Oak Road,410-555-0134,pat@x.com,0.5"].join(
      "\n"
    );
    const report = importCsv(csv);
    expect(report.drafts[0]).toMatchObject({
      ownerName: "Pat Cole",
      phone: "410-555-0134",
      email: "pat@x.com",
      acreage: 0.5,
    });
  });

  it("converts a lot size given in square feet", () => {
    const csv = ["Address,Lot Size Sqft", "5 Elm Ct,43560"].join("\n");
    expect(importCsv(csv).drafts[0].acreage).toBeCloseTo(1, 5);
  });

  it("treats an implausibly large acreage column as square feet", () => {
    const csv = ["Address,Acres", "5 Elm Ct,21780"].join("\n");
    expect(importCsv(csv).drafts[0].acreage).toBeCloseTo(0.5, 5);
  });

  it("refuses a file with no address column rather than guessing", () => {
    const report = importCsv("Name,Phone\nPat,410-555-0134");
    expect(report.drafts).toHaveLength(0);
    expect(report.skipped[0].reason).toMatch(/No address column/);
  });

  it("reports skipped rows with their line number", () => {
    const csv = ["Address,Owner", ",Nobody", "7 Pine Ln,Pat"].join("\n");
    const report = importCsv(csv);
    expect(report.drafts).toHaveLength(1);
    expect(report.skipped).toEqual([{ row: 2, reason: "No address" }]);
  });

  it("surfaces columns it didn't recognise instead of dropping them silently", () => {
    const report = importCsv("Address,Deed Book Page\n1 A St,12345");
    expect(report.unmappedHeaders).toContain("deed book page");
  });
});

describe("dedupeDrafts", () => {
  it("collapses the same address written differently", () => {
    const report = importCsv(["Address", "123 Main Street", "123 main st.", "9 Oak Rd"].join("\n"));
    const { unique, duplicates } = dedupeDrafts(report.drafts);
    expect(unique).toHaveLength(2);
    expect(duplicates).toBe(1);
  });
});

describe("applyTargetFilter", () => {
  const drafts = importCsv(
    [
      "Owner,Address,Zip,Acres",
      "Pat,1 Big Ln,21014,2",
      "Sam,2 Small Ct,21014,0.1",
      ",3 Blank Rd,21014,3",
      "Dana,4 Far Way,21001,5",
    ].join("\n")
  ).drafts;

  it("keeps only lots at or above the minimum", () => {
    const kept = applyTargetFilter(drafts, { minAcreage: 1, zips: [], requireOwner: false });
    expect(kept.map((d) => d.address)).toEqual(["1 Big Ln", "3 Blank Rd", "4 Far Way"]);
  });

  it("narrows to the zips being targeted", () => {
    const kept = applyTargetFilter(drafts, { minAcreage: null, zips: ["21014"], requireOwner: false });
    expect(kept).toHaveLength(3);
  });

  it("can require an owner name", () => {
    const kept = applyTargetFilter(drafts, { minAcreage: null, zips: [], requireOwner: true });
    expect(kept.map((d) => d.address)).not.toContain("3 Blank Rd");
  });
});
