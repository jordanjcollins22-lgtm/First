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
  return [home, ...content.areas.map((a) => (onWebsiteHost ? `${root}/areas/${areaSlug(a.town)}` : `${root}/site/areas/${areaSlug(a.town)}${q}`))];
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
  // The town pages, and the two files search engines ask the root for.
  if (/^\/areas\/[a-z0-9-]{1,80}\/?$/.test(pathname)) return `/site${pathname.replace(/\/$/, "")}`;
  if (pathname === "/robots.txt" || pathname === "/sitemap.xml") return `/site${pathname}`;
  return null;
}
