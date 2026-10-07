import { describe, expect, it } from "vitest";

import { anchorFromComparables, annualize, rankComparables } from "../sources/usaspending";
import { extractEmails, pickBestEmail } from "../sources/website-email";
import { normalizeBusinessName } from "../subfinder";
import type { Opportunity } from "../types";

describe("website email extraction", () => {
  it("finds plain, mailto and obfuscated emails and drops junk", () => {
    const html = `<a href="mailto:Office@AcmeLawn.com">Email</a> jane [at] acmelawn.com
      <img src="logo@2x.png"> errors@sentry.io info@example.com`;
    const emails = extractEmails(html);
    expect(emails).toContain("office@acmelawn.com");
    expect(emails).toContain("jane@acmelawn.com");
    expect(emails.some((e) => e.includes("sentry") || e.includes("example") || e.endsWith(".png"))).toBe(false);
  });

  it("prefers the site's own domain and generic inboxes", () => {
    expect(pickBestEmail(["bob@gmail.com", "info@acmelawn.com"], "https://www.acmelawn.com")).toBe("info@acmelawn.com");
    expect(pickBestEmail([], null)).toBeNull();
  });
});

describe("normalizeBusinessName", () => {
  it("ignores legal suffixes and punctuation", () => {
    expect(normalizeBusinessName("Acme Lawn & Landscape, LLC")).toBe(normalizeBusinessName("ACME LAWN AND LANDSCAPE INC."));
  });
});

describe("USAspending comparables", () => {
  const opp = {
    title: "Janitorial Services at the MVY ATCT",
    agency: "TRANSPORTATION, DEPARTMENT OF",
    office: "FAA",
    solicitationNumber: "697DCK-27-R-00001",
    placeOfPerformance: { zip: "02575", state: "MA" },
  } as unknown as Opportunity;

  const row = (id: string, amount: number, zip: string, desc: string) => ({
    "Award ID": id,
    "Recipient Name": id,
    "Award Amount": amount,
    "Start Date": "2024-01-01",
    "End Date": "2026-01-01",
    Description: desc,
    "Place of Performance Zip5": zip,
    generated_internal_id: id,
  });

  it("annualizes multi-year awards", () => {
    expect(annualize(200_000, "2024-01-01", "2026-01-01")).toBeCloseTo(100_000, -3);
    expect(annualize(5_000, "2024-01-01", "2024-03-01")).toBe(5_000);
  });

  it("ranks same-office, same-area awards first and anchors on them", () => {
    const ranked = rankComparables(opp, [
      row("W912WJ25PA028", 6_400, "02571", "JANITORIAL SERVICES, RECRUITING CENTER"),
      row("697DCK23C00163", 100_000, "02540", "JANITORIAL SERVICES AT THE ATCT"),
    ]);
    expect(ranked[0].awardId).toBe("697DCK23C00163");
    const anchor = anchorFromComparables(ranked);
    expect(anchor?.source).toContain("697DCK23C00163");
  });

  it("returns no anchor when nothing is similar", () => {
    expect(anchorFromComparables(rankComparables(opp, [row("X1", 9_000, "90210", "ROOF REPAIR")]))).toBeNull();
  });
});
