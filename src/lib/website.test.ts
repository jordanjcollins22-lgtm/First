import { describe, expect, it } from "vitest";

import {
  areaBySlug,
  areaHref,
  areaSlug,
  DEFAULT_WEBSITE,
  localBusinessJsonLd,
  MAX_SERVICES,
  normalizeWebsite,
  robotsTxt,
  serviceBySlug,
  serviceHref,
  serviceIntro,
  serviceJsonLd,
  serviceSlug,
  serviceTitle,
  sitemapXml,
  siteUrls,
  websiteLinks,
  websiteRewrite,
} from "@/lib/website";

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

describe("websiteRewrite", () => {
  it("serves the website at the root of the business's own domain", () => {
    expect(websiteRewrite("jslandscapingmd.com", "/")).toBe("/site");
    expect(websiteRewrite("www.jslandscapingmd.com", "/")).toBe("/site");
  });

  it("leaves the app's own domain and every other page alone", () => {
    expect(websiteRewrite("app.jslandscapingmd.com", "/")).toBeNull();
    expect(websiteRewrite("jslandscapingmd.com", "/book")).toBeNull();
    expect(websiteRewrite("app.jslandscapingmd.com", "/areas/bel-air")).toBeNull();
    expect(websiteRewrite(null, "/")).toBeNull();
  });
});

describe("town pages", () => {
  it("has the ten Harford towns by default, each with a page", () => {
    expect(DEFAULT_WEBSITE.areas.map((a) => a.town)).toContain("Havre de Grace");
    expect(DEFAULT_WEBSITE.areas).toHaveLength(10);
    expect(areaSlug("Havre de Grace")).toBe("havre-de-grace");
    expect(areaHref("js", "Bel Air")).toBe("/site/areas/bel-air?org=js");
    expect(areaBySlug(DEFAULT_WEBSITE, "joppa")?.town).toBe("Joppa");
    expect(areaBySlug(DEFAULT_WEBSITE, "baltimore")).toBeNull();
  });

  it("keeps edited towns, drops blanks and duplicates, and reads older rows", () => {
    const site = normalizeWebsite({ areas: [{ town: "Bel Air", intro: "Hi" }, { town: "bel  air" }, { town: "" }, "x"] });
    expect(site.areas).toEqual([{ town: "Bel Air", intro: "Hi" }]);
    expect(normalizeWebsite({}).areas).toHaveLength(10);
    expect(normalizeWebsite({}).showReviews).toBe(true);
  });

  it("serves town pages, robots and the sitemap at the root of the business's domain", () => {
    expect(websiteRewrite("jslandscapingmd.com", "/areas/bel-air")).toBe("/site/areas/bel-air");
    expect(websiteRewrite("jslandscapingmd.com", "/areas/bel-air/")).toBe("/site/areas/bel-air");
    expect(websiteRewrite("jslandscapingmd.com", "/robots.txt")).toBe("/site/robots.txt");
    expect(websiteRewrite("jslandscapingmd.com", "/sitemap.xml")).toBe("/site/sitemap.xml");
    expect(websiteRewrite("jslandscapingmd.com", "/areas/../admin")).toBeNull();
  });

  it("describes the business for search engines, town by town", () => {
    const ld = localBusinessJsonLd(DEFAULT_WEBSITE, "https://jslandscapingmd.com/areas/fallston", "Fallston");
    expect(ld["@type"]).toBe("LocalBusiness");
    expect(ld.areaServed).toEqual([{ "@type": "City", name: "Fallston, MD" }]);
    expect((localBusinessJsonLd(DEFAULT_WEBSITE, "https://x/").areaServed as unknown[]).length).toBe(10);
  });

  it("lists every page in the sitemap, on either domain", () => {
    const own = siteUrls("https://jslandscapingmd.com", true, DEFAULT_WEBSITE, "js");
    expect(own[0]).toBe("https://jslandscapingmd.com/");
    expect(own).toContain("https://jslandscapingmd.com/areas/havre-de-grace");
    const app = siteUrls("https://app.jslandscapingmd.com", false, DEFAULT_WEBSITE, "js");
    expect(app[0]).toBe("https://app.jslandscapingmd.com/site?org=js");
    const xml = sitemapXml(own.map((loc) => ({ loc, lastmod: "2026-10-13T00:00:00Z" })));
    expect(xml).toContain("<loc>https://jslandscapingmd.com/areas/bel-air</loc><lastmod>2026-10-13</lastmod>");
    expect(robotsTxt("https://jslandscapingmd.com/sitemap.xml")).toContain("Sitemap: https://jslandscapingmd.com/sitemap.xml");
  });
});

describe("service pages", () => {
  const mulch = DEFAULT_WEBSITE.services[2];

  it("gives every service a page, county-wide and in each town", () => {
    expect(serviceSlug("Mulch & bed refresh")).toBe("mulch-bed-refresh");
    expect(serviceBySlug(DEFAULT_WEBSITE, "mulch-bed-refresh")?.name).toBe("Mulch & bed refresh");
    expect(serviceBySlug(DEFAULT_WEBSITE, "pool-cleaning")).toBeNull();
    expect(serviceHref(null, "Lawn mowing")).toBe("/site/services/lawn-mowing");
    expect(serviceHref("js", "Lawn mowing", "Bel Air")).toBe("/site/areas/bel-air/lawn-mowing?org=js");
  });

  it("titles and describes the page by service and place", () => {
    expect(serviceTitle(mulch, "Fallston", "JS Landscaping")).toBe("Mulch & bed refresh in Fallston, MD · JS Landscaping");
    expect(serviceTitle(mulch, null, "JS Landscaping")).toBe("Mulch & bed refresh in Harford County, MD · JS Landscaping");
    expect(serviceIntro(mulch, "Fallston", "JS Landscaping")).toMatch(/^JS Landscaping does mulch & bed refresh in Fallston, Maryland\. Beds are weeded/);
    expect(serviceIntro({ name: "Grading", blurb: "Level ground." }, null, "JS")).toContain("Level ground.");
  });

  it("describes the service for search engines, with the business as provider", () => {
    const ld = serviceJsonLd(DEFAULT_WEBSITE, "https://jslandscapingmd.com/areas/joppa/mulch-bed-refresh", mulch, "Joppa");
    expect(ld["@type"]).toBe("Service");
    expect(ld.areaServed).toEqual([{ "@type": "City", name: "Joppa, MD" }]);
    expect((ld.provider as Record<string, unknown>)["@type"]).toBe("LocalBusiness");
    expect((serviceJsonLd(DEFAULT_WEBSITE, "https://x/", mulch).areaServed as unknown[]).length).toBe(10);
  });

  it("puts every service and service-in-town page in the sitemap", () => {
    const own = siteUrls("https://jslandscapingmd.com", true, DEFAULT_WEBSITE, null);
    expect(own).toHaveLength(1 + 10 + 6 + 60);
    expect(own).toContain("https://jslandscapingmd.com/services/lawn-mowing");
    expect(own).toContain("https://jslandscapingmd.com/areas/havre-de-grace/snow-removal-salting");
    const app = siteUrls("https://app.jslandscapingmd.com", false, DEFAULT_WEBSITE, "js");
    expect(app).toContain("https://app.jslandscapingmd.com/site/areas/bel-air/lawn-mowing?org=js");
  });

  it("serves the service pages at the root of the business's own domain", () => {
    expect(websiteRewrite("jslandscapingmd.com", "/services/lawn-mowing")).toBe("/site/services/lawn-mowing");
    expect(websiteRewrite("jslandscapingmd.com", "/areas/bel-air/lawn-mowing/")).toBe("/site/areas/bel-air/lawn-mowing");
    expect(websiteRewrite("jslandscapingmd.com", "/areas/bel-air/lawn-mowing/x")).toBeNull();
    expect(websiteRewrite("jslandscapingmd.com", "/services/../admin")).toBeNull();
  });
});
