import { describe, expect, it } from "vitest";

import {
  areaFromAddress,
  captionProblems,
  captionSystemPrompt,
  composeCaption,
  describeArea,
  fallbackCaption,
  privateTermsFor,
  scrubCaption,
} from "@/lib/social-caption";

const address = "2900 Lomond Place, Abingdon, Maryland 21009, United States";

describe("where the work was, as a post may say it", () => {
  it("is the town and zip, never the street", () => {
    expect(areaFromAddress(address)).toEqual({ town: "Abingdon", state: "MD", zip: "21009" });
    expect(describeArea(areaFromAddress(address))).toBe("Abingdon, MD 21009");
    expect(describeArea(areaFromAddress("12 Oak St, Bel Air, MD 21014"))).toBe("Bel Air, MD 21014");
    expect(describeArea(null)).toBe("Harford County, MD");
  });
});

describe("keeping the client out of the caption", () => {
  const terms = privateTermsFor("Sarah Miller", address);

  it("knows the names and the street, with and without its number", () => {
    expect(terms).toEqual(expect.arrayContaining(["Sarah", "Miller", "2900 Lomond Place", "Lomond Place"]));
  });

  it("scrubs them, and any other street line, out of what came back", () => {
    const dirty = "Sarah's front beds at 2900 Lomond Place look new. Also did 14 Oak Tree Lane. Lomond Place never looked better.";
    const clean = scrubCaption(dirty, terms);
    expect(clean).not.toMatch(/Sarah|Lomond|2900|Oak Tree Lane/);
    expect(captionProblems(clean, terms)).toEqual([]);
  });

  it("flags a street, a name or a claim we cannot make", () => {
    expect(captionProblems("Beds at 2900 Lomond Place.", terms).join(" ")).toMatch(/street/);
    expect(captionProblems("Thanks Miller family!", terms).join(" ")).toMatch(/client/);
    expect(captionProblems("We also do tree removal.", terms).join(" ")).toMatch(/tree work/);
  });

  it("tells the writer so, in the rules", () => {
    const prompt = captionSystemPrompt("JS Landscaping MD");
    expect(prompt).toMatch(/town and the zip code, and nothing narrower/);
    expect(prompt).toMatch(/Hook/);
    expect(prompt).toMatch(/Meat/);
    expect(prompt).toMatch(/CTA/);
    expect(prompt).toMatch(/SEO/);
  });
});

describe("the four parts", () => {
  it("are one paragraph each, in order", () => {
    expect(composeCaption({ hook: "H.", meat: "M.", cta: "C.", seo: "S." })).toBe("H.\n\nM.\n\nC.\n\nS.");
  });

  it("have a template that keeps the same shape, the link and the phone", () => {
    const text = fallbackCaption({ service: "Mulching", area: areaFromAddress(address), phone: "443-819-1521", bookingUrl: "https://x.test/r/abc" });
    expect(text.split("\n\n")).toHaveLength(4);
    expect(text).toContain("https://x.test/r/abc");
    expect(text).toContain("443-819-1521");
    expect(text).toContain("Abingdon, MD 21009");
    expect(text).toMatch(/#Mulching/);
    expect(text).not.toMatch(/Lomond|[—–]/);
  });
});
