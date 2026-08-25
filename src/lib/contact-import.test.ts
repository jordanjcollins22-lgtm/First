import { describe, expect, it } from "vitest";

import { parseContactCsv } from "@/lib/contact-import";

/** A GoHighLevel contact export, headers as GHL writes them. */
const GHL = [
  "Contact Id,First Name,Last Name,Email,Phone,Address,City,State,Postal Code,Tags,Source,DND,Notes",
  'abc123,Pat,Rivera,PAT@example.com,+1 (410) 555-0134,208 Crafton Rd,Bel Air,MD,21014,"client, mulch",Facebook Ad,false,Repeat customer',
  'def456,Bob,Stone,bob@stoneyard.com,410-555-0199,,,MD,,"supplier",Referral,true,',
].join("\n");

describe("parseContactCsv", () => {
  it("reads GoHighLevel's own column names", () => {
    const { drafts } = parseContactCsv(GHL);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      name: "Pat Rivera",
      email: "PAT@example.com",
      externalId: "abc123",
      source: "Facebook Ad",
    });
  });

  it("joins the address parts into one line for the geocoder", () => {
    const { drafts } = parseContactCsv(GHL);
    expect(drafts[0].address).toBe("208 Crafton Rd, Bel Air, MD, 21014");
  });

  it("keeps a partial address rather than discarding it", () => {
    // It will not resolve to a property, but it says roughly where they are.
    const { drafts } = parseContactCsv(GHL);
    expect(drafts[1].address).toBe("MD");
  });

  it("splits the tags cell the way a CRM writes it", () => {
    const { drafts } = parseContactCsv(GHL);
    expect(drafts[0].tags).toEqual(["client", "mulch"]);
  });

  it("carries the opt-out across, which is the one that cannot be lost", () => {
    const { drafts } = parseContactCsv(GHL);
    expect(drafts[0].doNotContact).toBe(false);
    expect(drafts[1].doNotContact).toBe(true);
  });

  it("treats anything that is not plainly false as opted out", () => {
    // Exports write this half a dozen ways and the cost of reading it wrong
    // is contacting somebody who asked not to be.
    const csv = ["Name,DND", "A,yes", "B,1", "C,TRUE", "D,no", "E,", "F,0"].join("\n");
    expect(parseContactCsv(csv).drafts.map((d) => d.doNotContact)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it("collapses the same person appearing twice in one file", () => {
    const csv = [
      "Contact Id,Name,Email",
      "x1,Pat Rivera,pat@example.com",
      "x1,Pat Rivera,pat@example.com",
    ].join("\n");
    const report = parseContactCsv(csv);
    expect(report.drafts).toHaveLength(1);
    expect(report.skipped[0].reason).toContain("appears earlier");
  });

  it("keeps a contact who has a phone and no name", () => {
    // Dropping somebody's number because nobody typed a name loses the only
    // thing on the row that mattered.
    const csv = ["Name,Phone", ",410-555-0100"].join("\n");
    const { drafts } = parseContactCsv(csv);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].name).toBe("410-555-0100");
  });

  it("skips a row with nothing to identify anybody by", () => {
    const csv = ["Name,Email,Phone,Notes", ",,,just a note"].join("\n");
    const report = parseContactCsv(csv);
    expect(report.drafts).toEqual([]);
    expect(report.skipped[0].reason).toBe("No name, email or phone");
  });

  it("names the columns nothing claimed, rather than dropping them silently", () => {
    // A column carrying something important should be visible.
    const csv = ["Name,Email,Pipeline Stage,Opportunity Value", "Pat,pat@x.com,Won,4200"].join("\n");
    expect(parseContactCsv(csv).unmatchedHeaders).toEqual(["Pipeline Stage", "Opportunity Value"]);
  });

  it("refuses a file that is plainly not a contact export", () => {
    const csv = ["Acres,Assessed Value", "1.2,300000"].join("\n");
    const report = parseContactCsv(csv);
    expect(report.drafts).toEqual([]);
    expect(report.skipped[0].reason).toContain("Check this is a contact export");
  });

  it("says so plainly when the file has only a header", () => {
    expect(parseContactCsv("Name,Email").skipped[0].reason).toContain("no rows");
  });

  it("prefers a single full-name column when the export has one", () => {
    const csv = ["Name,Email", "Dana Holt,dana@x.com"].join("\n");
    expect(parseContactCsv(csv).drafts[0].name).toBe("Dana Holt");
  });
});
