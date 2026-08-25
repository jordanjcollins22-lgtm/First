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

  it("keeps the pipeline the CRM had them in, verbatim", () => {
    // Not mapped onto this app's stages: a stage named in somebody else's
    // system means what they meant by it, and guessing turns a won deal into
    // an open one.
    const csv = [
      "Name,Email,Pipeline,Stage,Opportunity Value",
      'Pat,pat@x.com,Landscaping,Proposal Sent,"$4,200.00"',
    ].join("\n");
    const [draft] = parseContactCsv(csv).drafts;
    expect(draft.pipeline).toBe("Landscaping");
    expect(draft.pipelineStage).toBe("Proposal Sent");
    expect(draft.opportunityValue).toBe(4200);
  });

  it("has no opportunity value when the cell is empty or not a number", () => {
    const csv = ["Name,Opportunity Value", "Pat,", "Dana,TBD"].join("\n");
    expect(parseContactCsv(csv).drafts.map((d) => d.opportunityValue)).toEqual([null, null]);
  });

  it("names the columns nothing claimed, rather than dropping them silently", () => {
    // A column carrying something important should be visible.
    const csv = ["Name,Email,Opportunity Name,Assigned User", "Pat,pat@x.com,Backyard,Mike"].join("\n");
    expect(parseContactCsv(csv).unmatchedHeaders).toEqual(["Opportunity Name", "Assigned User"]);
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

describe("re-importing the same export with a column added", () => {
  // The exact case: contacts imported once without addresses, then the same
  // export again with them. It must match rather than duplicate, and it must
  // actually save the addresses — matching and then doing nothing is the
  // failure that sends somebody round the loop a third time.
  it("produces the same identity both times, so the rows match", () => {
    const withoutAddress = ["Contact Id,First Name,Last Name,Email", "abc123,Pat,Rivera,pat@x.com"].join("\n");
    const withAddress = [
      "Contact Id,First Name,Last Name,Email,Address,City,State,Postal Code",
      "abc123,Pat,Rivera,pat@x.com,208 Crafton Rd,Bel Air,MD,21014",
    ].join("\n");

    const first = parseContactCsv(withoutAddress).drafts[0];
    const second = parseContactCsv(withAddress).drafts[0];

    expect(first.externalId).toBe(second.externalId);
    expect(first.email).toBe(second.email);
    expect(first.address).toBeNull();
    expect(second.address).toBe("208 Crafton Rd, Bel Air, MD, 21014");
  });

  it("still matches on email when the export carries no contact id", () => {
    const first = parseContactCsv(["Name,Email", "Pat Rivera,pat@x.com"].join("\n")).drafts[0];
    const second = parseContactCsv(
      ["Name,Email,Address", "Pat Rivera,pat@x.com,208 Crafton Rd"].join("\n")
    ).drafts[0];

    expect(first.email).toBe(second.email);
    expect(second.address).toBe("208 Crafton Rd");
  });
});
