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
}

export const MAX_SERVICES = 12;
export const MAX_REASONS = 6;

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
  };
}

/** Where the site's buttons go: the app's own booking, quick mow and salt pages, so every lead lands in the app. */
export function websiteLinks(orgSlug: string | null) {
  const q = orgSlug ? `?org=${encodeURIComponent(orgSlug)}` : "";
  return { book: `/book${q}`, mow: `/mow${q}`, salt: `/salt${q}`, site: `/site${q}` };
}
