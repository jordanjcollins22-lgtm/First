/**
 * What the business's website says, and the defaults it starts from.
 *
 * Stored as one JSON document per business (website_settings.content). Read
 * through normalizeWebsite every time, so a row written by an older editor,
 * a missing key or a value of the wrong shape can never break the public page:
 * anything unusable falls back to the default for that field.
 */

export interface WebsiteService {
  name: string;
  blurb: string;
}

/** A town the business works in, with its own page at /site/areas/<slug>. */
export interface WebsiteArea {
  town: string;
  /** What the page says about working there. Empty means the default paragraph. */
  intro: string;
}

export interface WebsiteContent {
  businessName: string;
  heroHeadline: string;
  heroSub: string;
  ctaLabel: string;
  phone: string;
  email: string;
  serviceArea: string;
  services: WebsiteService[];
  whyUs: string[];
  about: string;
  showQuickMow: boolean;
  showSalt: boolean;
  /** One page per town, for people searching "<service> <town>". */
  areas: WebsiteArea[];
  /** Show the Google reviews pulled from the Business Profile, when it is connected. */
  showReviews: boolean;
}

export const MAX_SERVICES = 12;
export const MAX_REASONS = 6;
export const MAX_AREAS = 30;

/** Harford County towns the service area names, each with a page of its own. */
export const DEFAULT_AREA_TOWNS = [
  "Bel Air",
  "Forest Hill",
  "Fallston",
  "Abingdon",
  "Aberdeen",
  "Havre de Grace",
  "Joppa",
  "Jarrettsville",
  "Street",
  "Churchville",
] as const;

export const DEFAULT_WEBSITE: WebsiteContent = {
  businessName: "JS Landscaping",
  heroHeadline: "A yard you're proud to come home to.",
  heroSub: "Lawn care, landscaping and seasonal work across Harford County, Maryland. Book a free evaluation online in under a minute.",
  ctaLabel: "Book a free evaluation",
  phone: "",
  email: "",
  serviceArea: "Bel Air, Forest Hill, Fallston, Abingdon, Aberdeen, Havre de Grace and the rest of Harford County.",
  services: [
    { name: "Lawn mowing", blurb: "Weekly or every-other-week cuts, edged and blown clean." },
    { name: "Aeration & overseeding", blurb: "Thicker, greener grass going into next season." },
    { name: "Mulch & bed refresh", blurb: "Weeded, edged and topped with fresh mulch." },
    { name: "Fall cleanup & leaf removal", blurb: "Leaves gone, beds cut back, gutters clear." },
    { name: "Shrub & tree trimming", blurb: "Shaped, thinned and hauled away." },
    { name: "Snow removal & salting", blurb: "Driveways and walks cleared before you leave for work." },
  ],
  whyUs: [
    "Free on-site evaluation with a written price",
    "Photos of every finished job",
    "Locally owned in Harford County",
  ],
  about: "We're a local crew that shows up when we say we will, does the job right the first time, and sends you photos when it's done.",
  showQuickMow: true,
  showSalt: true,
  areas: DEFAULT_AREA_TOWNS.map((town) => ({ town, intro: "" })),
  showReviews: true,
};

function text(value: unknown, fallback: string, max: number): string {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, max);
}

/** The stored document, made safe to render. `businessName` falls back to the organisation's own name. */
export function normalizeWebsite(stored: unknown, orgName?: string | null): WebsiteContent {
  const s = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const d = { ...DEFAULT_WEBSITE, businessName: orgName?.trim() || DEFAULT_WEBSITE.businessName };

  const services = Array.isArray(s.services)
    ? s.services
        .map((x) => {
          const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
          return { name: text(o.name, "", 60), blurb: text(o.blurb, "", 200) };
        })
        .filter((x) => x.name)
        .slice(0, MAX_SERVICES)
    : d.services;
  const areas = Array.isArray(s.areas)
    ? s.areas
        .map((x) => {
          const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
          return { town: text(o.town, "", 60), intro: text(o.intro, "", 1500) };
        })
        .filter((x, i, all) => x.town && areaSlug(x.town) && all.findIndex((y) => areaSlug(y.town) === areaSlug(x.town)) === i)
        .slice(0, MAX_AREAS)
    : d.areas;
  const whyUs = Array.isArray(s.whyUs)
    ? s.whyUs.map((x) => text(x, "", 120)).filter(Boolean).slice(0, MAX_REASONS)
    : d.whyUs;

  return {
    businessName: text(s.businessName, d.businessName, 80) || d.businessName,
    heroHeadline: text(s.heroHeadline, d.heroHeadline, 120) || d.heroHeadline,
    heroSub: text(s.heroSub, d.heroSub, 300),
    ctaLabel: text(s.ctaLabel, d.ctaLabel, 40) || d.ctaLabel,
    phone: text(s.phone, d.phone, 30),
    email: text(s.email, d.email, 120),
    serviceArea: text(s.serviceArea, d.serviceArea, 400),
    services,
    whyUs,
    about: text(s.about, d.about, 1200),
    showQuickMow: typeof s.showQuickMow === "boolean" ? s.showQuickMow : d.showQuickMow,
    showSalt: typeof s.showSalt === "boolean" ? s.showSalt : d.showSalt,
    areas,
    showReviews: typeof s.showReviews === "boolean" ? s.showReviews : d.showReviews,
  };
}

/** "Havre de Grace" → "havre-de-grace". */
export function areaSlug(town: string): string {
  return town
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function areaBySlug(content: WebsiteContent, slug: string): WebsiteArea | null {
  return content.areas.find((a) => areaSlug(a.town) === slug) ?? null;
}

/** The paragraph a town page says when the owner hasn't written one. */
export function defaultAreaIntro(town: string, businessName: string): string {
  return `${businessName} looks after lawns and yards in ${town}, Maryland: weekly mowing, mulch and bed refreshes, aeration and overseeding, fall cleanup, and snow removal when winter comes. We're local to Harford County, so a crew is usually already working near you. Book a free evaluation and we'll come take a look, measure up and send a written price.`;
}

/** Where a town page lives, keeping ?org= when there is one. */
export function areaHref(orgSlug: string | null, town: string): string {
  const q = orgSlug ? `?org=${encodeURIComponent(orgSlug)}` : "";
  return `/site/areas/${areaSlug(town)}${q}`;
}

export interface SiteReview {
  author: string;
  stars: number;
  body: string;
  writtenOn: string | null;
}

/**
 * The schema.org LocalBusiness description search engines read, for the
 * home page or one town's page. No rating is claimed: Google ignores
 * self-served review markup on a business's own site, and the reviews are
 * shown as text instead.
 */
export function localBusinessJsonLd(c: WebsiteContent, pageUrl: string, town?: string | null): Record<string, unknown> {
  const served = town ? [town] : c.areas.map((a) => a.town);
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: c.businessName,
    url: pageUrl,
    ...(c.phone ? { telephone: c.phone } : {}),
    ...(c.email ? { email: c.email } : {}),
    description: town ? defaultAreaIntro(town, c.businessName) : c.heroSub || c.heroHeadline,
    address: { "@type": "PostalAddress", addressRegion: "MD", addressCountry: "US", ...(town ? { addressLocality: town } : {}) },
    areaServed: served.map((name) => ({ "@type": "City", name: `${name}, MD` })),
    makesOffer: c.services.map((sv) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: sv.name, ...(sv.blurb ? { description: sv.blurb } : {}) } })),
  };
}

/** "Mulch & bed refresh" → "mulch-bed-refresh". The same rule as a town's slug. */
export function serviceSlug(name: string): string {
  return areaSlug(name);
}

export function serviceBySlug(content: WebsiteContent, slug: string): WebsiteService | null {
  return content.services.find((s) => serviceSlug(s.name) === slug) ?? null;
}

/** Where a service's page lives: /site/services/<service>, or /site/areas/<town>/<service> for one town. */
export function serviceHref(orgSlug: string | null, service: string, town?: string | null): string {
  const q = orgSlug ? `?org=${encodeURIComponent(orgSlug)}` : "";
  return town ? `/site/areas/${areaSlug(town)}/${serviceSlug(service)}${q}` : `/site/services/${serviceSlug(service)}${q}`;
}

/**
 * What each of the starting services is, in a sentence or two of its own, so
 * a service page says something a town page does not. A service the owner
 * added in the editor gets the general paragraph with its own name.
 */
const SERVICE_DETAIL: Record<string, string> = {
  "lawn-mowing":
    "Every cut is mowed at the right height for the season, string-trimmed along beds and fences, edged at the driveway and walks, and blown clean. Weekly or every other week, the same crew on the same day.",
  "aeration-overseeding":
    "Core aeration opens up compacted soil so water and seed reach the roots, then we overseed with a blend that suits Maryland's transition zone. Early fall is the best window; spring works too.",
  "mulch-bed-refresh":
    "Beds are weeded, given a crisp spade edge, and topped with fresh mulch at the right depth, kept off stems and trunks. It's the quickest way to make a whole yard look finished.",
  "fall-cleanup-leaf-removal":
    "Leaves are cleared from the lawn and beds and hauled away, perennials cut back, and gutters cleared on request, so the grass isn't smothered over winter.",
  "shrub-tree-trimming":
    "Shrubs are shaped and thinned at the right time of year for each plant, small trees raised and cleaned up, and every clipping hauled away.",
  "snow-removal-salting":
    "Driveways and walks are plowed or shoveled and salted before you leave for work, with salt you can prepay for the season.",
};

/** The paragraph a service page says: what the service is, and where. */
export function serviceIntro(service: WebsiteService, town: string | null, businessName: string): string {
  const where = town ? `${town}, Maryland` : "Harford County, Maryland";
  const detail = SERVICE_DETAIL[serviceSlug(service.name)] ?? (service.blurb ? `${service.blurb}` : "");
  const lead = `${businessName} does ${service.name.toLowerCase()} in ${where}.`;
  const close = town
    ? `We're local to Harford County, so a crew is usually already working near ${town}. Book a free evaluation and we'll come look, measure and send a written price.`
    : "Book a free evaluation and we'll come look, measure and send a written price.";
  return [lead, detail, close].filter(Boolean).join(" ");
}

/** A page title that names the service and the place first, as people search for it. */
export function serviceTitle(service: WebsiteService, town: string | null, businessName: string): string {
  return `${service.name} in ${town ?? "Harford County"}, MD · ${businessName}`;
}

/**
 * The schema.org Service description for a service page, with the business
 * as its provider and the town (or every town) as where it is offered.
 */
export function serviceJsonLd(c: WebsiteContent, pageUrl: string, service: WebsiteService, town?: string | null): Record<string, unknown> {
  const served = town ? [town] : c.areas.map((a) => a.town);
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: town ? `${service.name} in ${town}, MD` : service.name,
    serviceType: service.name,
    url: pageUrl,
    description: serviceIntro(service, town ?? null, c.businessName),
    areaServed: served.map((name) => ({ "@type": "City", name: `${name}, MD` })),
    provider: {
      "@type": "LocalBusiness",
      name: c.businessName,
      ...(c.phone ? { telephone: c.phone } : {}),
      ...(c.email ? { email: c.email } : {}),
      address: { "@type": "PostalAddress", addressRegion: "MD", addressCountry: "US", ...(town ? { addressLocality: town } : {}) },
    },
  };
}

function xmlEscape(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** sitemap.xml for the site's pages. */
export function sitemapXml(urls: readonly { loc: string; lastmod?: string | null }[]): string {
  const body = urls
    .map((u) => `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod.slice(0, 10)}</lastmod>` : ""}</url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/**
 * The site's public addresses. On the business's own domain the site is
 * the root and town pages are /areas/<slug>; on the app's domain they live
 * under /site.
 */
export function siteUrls(origin: string, onWebsiteHost: boolean, content: WebsiteContent, orgSlug: string | null): string[] {
  const root = origin.replace(/\/$/, "");
  const q = !onWebsiteHost && orgSlug ? `?org=${encodeURIComponent(orgSlug)}` : "";
  const home = onWebsiteHost ? `${root}/` : `${root}/site${q}`;
  const at = (path: string) => (onWebsiteHost ? `${root}${path}` : `${root}/site${path}${q}`);
  const services = content.services.map((s) => serviceSlug(s.name)).filter(Boolean);
  return [
    home,
    ...content.areas.map((a) => at(`/areas/${areaSlug(a.town)}`)),
    ...services.map((s) => at(`/services/${s}`)),
    ...content.areas.flatMap((a) => services.map((s) => at(`/areas/${areaSlug(a.town)}/${s}`))),
  ];
}

export function robotsTxt(sitemapUrl: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n`;
}

export function isWebsiteHost(host: string | null): boolean {
  const name = (host ?? "").toLowerCase().split(":")[0];
  return (WEBSITE_HOSTS as readonly string[]).includes(name);
}

/** Where the site's buttons go: the app's own booking, quick mow and salt pages, so every lead lands in the app. */
export function websiteLinks(orgSlug: string | null) {
  const q = orgSlug ? `?org=${encodeURIComponent(orgSlug)}` : "";
  return { book: `/book${q}`, mow: `/mow${q}`, salt: `/salt${q}`, site: `/site${q}` };
}

/** The business's own domain. Opened there, the app is the website rather than the sign-in page. */
export const WEBSITE_HOSTS = ["jslandscapingmd.com", "www.jslandscapingmd.com"] as const;

/** Where a request on the website's domain is served from, or null to carry on as the app. */
export function websiteRewrite(host: string | null, pathname: string): string | null {
  if (!isWebsiteHost(host)) return null;
  if (pathname === "/") return "/site";
  // The town and service pages, and the two files search engines ask the root for.
  if (/^\/areas\/[a-z0-9-]{1,80}(\/[a-z0-9-]{1,80})?\/?$/.test(pathname)) return `/site${pathname.replace(/\/$/, "")}`;
  if (/^\/services\/[a-z0-9-]{1,80}\/?$/.test(pathname)) return `/site${pathname.replace(/\/$/, "")}`;
  if (pathname === "/robots.txt" || pathname === "/sitemap.xml") return `/site${pathname}`;
  return null;
}
