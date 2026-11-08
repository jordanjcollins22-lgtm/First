/**
 * Local search: which towns the business really works in, and what the
 * Google Business Profile should say each week.
 *
 * Pure. The review page and anything else read rows and hand them in.
 */

import { areaSlug } from "@/lib/website";

/**
 * The town in an address the way the app stores them ("12 Main St, Bel Air,
 * MD 21014" → "Bel Air"), or null when the second part is not a town: a
 * suite number, a coordinate, nothing at all.
 */
export function townFromAddress(address: string | null | undefined): string | null {
  const part = (address ?? "").split(",")[1]?.trim() ?? "";
  if (!part || /\d/.test(part) || /^(suite|ste|apt|unit|#)\b/i.test(part)) return null;
  if (!/^[a-z][a-z .'-]{1,40}$/i.test(part)) return null;
  // "HAVRE DE GRACE" and "havre de grace" are the same town; small words stay small.
  return part
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && ["de", "of", "the"].includes(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

export interface TownCoverage {
  town: string;
  jobs: number;
  done: number;
  /** The website has a page for it. */
  hasPage: boolean;
}

/**
 * Towns from the jobs, most worked first, each marked with whether the
 * website already has its pages. A town with two or more jobs and no page is
 * one worth adding in the website editor; one job may be a one-off.
 */
export function townCoverage(jobs: readonly { address: string | null; completed: boolean }[], pageTowns: readonly string[]): TownCoverage[] {
  const pages = new Set(pageTowns.map(areaSlug));
  const byTown = new Map<string, TownCoverage>();
  for (const j of jobs) {
    const town = townFromAddress(j.address);
    if (!town) continue;
    const key = areaSlug(town);
    const row = byTown.get(key) ?? { town, jobs: 0, done: 0, hasPage: pages.has(key) };
    row.jobs += 1;
    if (j.completed) row.done += 1;
    byTown.set(key, row);
  }
  return [...byTown.values()].sort((a, b) => b.jobs - a.jobs || a.town.localeCompare(b.town));
}

/** Towns the jobs say deserve a page that the site does not have yet. */
export function missingTownPages(coverage: readonly TownCoverage[], minJobs = 2): string[] {
  return coverage.filter((t) => !t.hasPage && t.jobs >= minJobs).map((t) => t.town);
}

export type Season = "winter" | "spring" | "summer" | "fall";

export function seasonOf(date: Date): Season {
  const m = date.getUTCMonth();
  if (m <= 1 || m === 11) return "winter";
  if (m <= 4) return "spring";
  if (m <= 7) return "summer";
  return "fall";
}

/** Words that tie a service to the season it sells in. */
const SEASON_WORDS: Record<Season, RegExp> = {
  winter: /snow|salt|ice/i,
  spring: /mulch|bed|clean|plant|mow|lawn/i,
  summer: /mow|lawn|trim|shrub|weed/i,
  fall: /aerat|seed|leaf|leaves|fall|clean/i,
};

/** The services to talk about this season, in the order the site lists them; all of them when none match. */
export function seasonalServices(services: readonly string[], season: Season): string[] {
  const hit = services.filter((s) => SEASON_WORDS[season].test(s));
  return hit.length ? hit : [...services];
}

export interface GbpWeek {
  /** Monday of the week, YYYY-MM-DD. */
  weekOf: string;
  season: Season;
  /** The one post for the week. */
  post: { kind: "before_after" | "offer" | "update" | "faq"; title: string; body: string };
  /** The same few things every week. */
  checklist: string[];
}

const WEEK = 7 * 24 * 60 * 60 * 1000;

function mondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 24 * 60 * 60 * 1000);
}

/**
 * What the Business Profile posts and updates each week: one post a week,
 * rotating a finished job's before and after, a seasonal offer, a crew
 * update and a common question, each naming a real town the business works
 * in and a service it sells that season. Google rewards a listing that is
 * kept fresh with real photos, and the town names are what people search.
 */
export function gbpWeeklyPlan(input: { from: Date; towns: readonly string[]; services: readonly string[]; weeks?: number; businessName: string }): GbpWeek[] {
  const weeks = Math.max(1, Math.min(input.weeks ?? 4, 12));
  const towns = input.towns.length ? input.towns : ["Harford County"];
  const start = mondayOf(input.from);
  // Count weeks from a fixed Monday so the rotation does not restart each time the plan is read.
  const epoch = mondayOf(new Date(Date.UTC(2026, 0, 5)));
  const out: GbpWeek[] = [];
  for (let i = 0; i < weeks; i++) {
    const monday = new Date(start.getTime() + i * WEEK);
    const n = Math.round((monday.getTime() - epoch.getTime()) / WEEK);
    const season = seasonOf(monday);
    const services = seasonalServices(input.services, season);
    const service = services[((n % services.length) + services.length) % services.length] ?? "Lawn care";
    const town = towns[((n % towns.length) + towns.length) % towns.length];
    const kind = (["before_after", "offer", "update", "faq"] as const)[((n % 4) + 4) % 4];
    out.push({ weekOf: monday.toISOString().slice(0, 10), season, post: postFor(kind, service, town, season, input.businessName), checklist: CHECKLIST });
  }
  return out;
}

const CHECKLIST = [
  "Reply to every new review (the daily run drafts these; approve the 1 to 3 star ones).",
  "Add 3 or more photos from this week's finished jobs, named for the town and the service.",
  "Check hours, phone and the services list still match the website.",
  "Answer any new question on the listing, and add one you get asked a lot.",
];

function postFor(kind: GbpWeek["post"]["kind"], service: string, town: string, season: Season, business: string): GbpWeek["post"] {
  const s = service.toLowerCase();
  switch (kind) {
    case "before_after":
      return {
        kind,
        title: `Before and after: ${s} in ${town}`,
        body: `Use a finished job's approved before and after from ${town}. "Another ${s} job finished in ${town}. Book a free evaluation and we'll send a written price." Button: Book.`,
      };
    case "offer":
      return {
        kind,
        title: `${season[0].toUpperCase()}${season.slice(1)} ${s}: book now`,
        body: `An offer post for ${s} this ${season}: what's included, the window it's best done in, and "free evaluation, written price". Mention ${town} and nearby towns. Button: Book.`,
      };
    case "update":
      return {
        kind,
        title: `This week around ${town}`,
        body: `A What's New post with a crew photo on the job in ${town}: what ${business} worked on this week, and the days a crew is in the area for anyone nearby who wants ${s}.`,
      };
    case "faq":
      return {
        kind,
        title: `Question of the week: ${s}`,
        body: `Answer one question clients ask about ${s} (how often, how long it takes, what it costs to start) in two or three sentences, ending with "Serving ${town} and the rest of Harford County."`,
      };
  }
}
