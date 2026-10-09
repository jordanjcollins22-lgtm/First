import { describe, expect, it } from "vitest";

import { DEFAULT_WEBSITE, MAX_SERVICES, normalizeWebsite, websiteLinks } from "@/lib/website";

describe("normalizeWebsite", () => {
  it("starts from the defaults, under the business's own name", () => {
    const site = normalizeWebsite(null, "Green Acres");
    expect(site.businessName).toBe("Green Acres");
    expect(site.services).toEqual(DEFAULT_WEBSITE.services);
  });

  it("keeps what was saved and fills in what wasn't", () => {
    const site = normalizeWebsite({ heroHeadline: "  Hello  ", phone: "410-555-0100" });
    expect(site.heroHeadline).toBe("Hello");
    expect(site.phone).toBe("410-555-0100");
    expect(site.ctaLabel).toBe(DEFAULT_WEBSITE.ctaLabel);
  });

  it("never renders an empty headline or button", () => {
    const site = normalizeWebsite({ heroHeadline: "", ctaLabel: "   " });
    expect(site.heroHeadline).toBe(DEFAULT_WEBSITE.heroHeadline);
    expect(site.ctaLabel).toBe(DEFAULT_WEBSITE.ctaLabel);
  });

  it("drops services with no name and caps the list", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `S${i}`, blurb: "" }));
    expect(normalizeWebsite({ services: [{ name: "", blurb: "x" }, ...many] }).services).toHaveLength(MAX_SERVICES);
    expect(normalizeWebsite({ services: [] }).services).toEqual([]);
  });

  it("ignores values of the wrong shape", () => {
    const site = normalizeWebsite({ services: "mowing", showSalt: "no", whyUs: [1, "Fast"] });
    expect(site.services).toEqual(DEFAULT_WEBSITE.services);
    expect(site.showSalt).toBe(true);
    expect(site.whyUs).toEqual(["Fast"]);
  });
});

describe("websiteLinks", () => {
  it("sends every button to the app's own pages for this business", () => {
    expect(websiteLinks("js-landscaping").book).toBe("/book?org=js-landscaping");
    expect(websiteLinks(null).mow).toBe("/mow");
  });
});
