/**
 * The seasonal cross-sell: one email a season to people who already paid
 * the business, offering the next thing their yard needs.
 *
 * Three seasons, on the mid-Atlantic calendar: spring cleanup in the late
 * winter, aeration and overseeding in late summer, snow and salt in the
 * autumn. Each goes once per client per season per year (the dedupe key
 * says so), and only to clients the business has finished a job for.
 *
 * The owner starts each season after seeing who it goes to and what it
 * says, or, with automatic mode and a go-live date, it starts itself on the
 * first run inside its window after that date.
 *
 * Pure.
 */

export const SEASONS = ["spring_cleanup", "aeration", "snow_presell"] as const;
export type Season = (typeof SEASONS)[number];

export interface SeasonInfo {
  label: string;
  /** [month, day] inclusive, local. */
  opens: [number, number];
  closes: [number, number];
  subject: string;
  pitch: string;
}

export const SEASON_INFO: Record<Season, SeasonInfo> = {
  spring_cleanup: {
    label: "Spring cleanup",
    opens: [1, 15],
    closes: [3, 31],
    subject: "Getting your yard ready for spring",
    pitch:
      "Spring cleanup books up fast once the weather turns. We'll clear the winter debris, cut back and edge the beds, and put down fresh mulch so the yard is ready before the first warm weekend.",
  },
  aeration: {
    label: "Aeration & overseeding",
    opens: [8, 1],
    closes: [9, 30],
    subject: "The best time of year to thicken your lawn",
    pitch:
      "Late summer into early fall is the best window all year to aerate and overseed in Harford County. The soil is warm, the nights are cooling off, and new grass has time to root before winter.",
  },
  snow_presell: {
    label: "Snow & salt pre-sell",
    opens: [9, 1],
    closes: [11, 15],
    subject: "Get on our snow list before the first storm",
    pitch:
      "We're filling this winter's snow and salt routes now. Clients on the list are cleared first, before the morning commute, and never have to call around during a storm.",
  },
};

function monthDay(now: Date, timeZone = "America/New_York"): [number, number, number] {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return [get("year"), get("month"), get("day")];
}

export function inWindow(season: Season, now: Date): boolean {
  const [, m, d] = monthDay(now);
  const at = m * 100 + d;
  const { opens, closes } = SEASON_INFO[season];
  return at >= opens[0] * 100 + opens[1] && at <= closes[0] * 100 + closes[1];
}

/** The seasons open right now. */
export function openSeasons(now: Date): Season[] {
  return SEASONS.filter((s) => inWindow(s, now));
}

/** The season's year: the calendar year its window opens in. */
export function seasonYear(now: Date): number {
  return monthDay(now)[0];
}

export function seasonalDedupeKey(season: Season, year: number, customerId: string): string {
  return `seasonal:${season}:${year}:${customerId}`;
}

export interface PastClient {
  customerId: string;
  name: string | null;
  email: string | null;
  completedJobs: number;
  /** Service ids and names they have had, lower-case. */
  services: string[];
  /** Whether they already pre-booked salt or snow this season. */
  hasSnowThisSeason: boolean;
  doNotContact: boolean;
}

const has = (services: string[], words: RegExp) => services.some((s) => words.test(s));

/** Why a client is or isn't in a season's audience, in a few words. Null means in. */
export function excludedBecause(season: Season, c: PastClient): string | null {
  if (c.doNotContact) return "asked not to be contacted";
  if (!c.email) return "no email";
  if (c.completedJobs < 1) return "no finished job yet";
  if (season === "aeration" && has(c.services, /aerat|overseed/)) return "already has aeration";
  if (season === "aeration" && c.services.length > 0 && !has(c.services, /lawn|mow|grass|turf|seed|fert/)) return "no lawn work on record";
  if (season === "snow_presell" && (c.hasSnowThisSeason || has(c.services, /snow|salt|plow/))) return "already on snow";
  return null;
}

export function seasonAudience(season: Season, clients: readonly PastClient[]): PastClient[] {
  return clients.filter((c) => excludedBecause(season, c) == null);
}

/** The email, in plain words, with the booking link last. */
export function seasonalEmail(season: Season, client: Pick<PastClient, "name">, business: { name: string; phone: string | null }, bookUrl: string): { subject: string; body: string } {
  const info = SEASON_INFO[season];
  const first = (client.name ?? "").trim().split(/\s+/)[0];
  const hello = first ? `Hi ${first},` : "Hi there,";
  const call = business.phone ? ` or call or text ${business.phone}` : "";
  return {
    subject: info.subject,
    body: [
      hello,
      "",
      `Thanks again for trusting ${business.name} with your yard. ${info.pitch}`,
      "",
      `Past clients get first pick of dates. Book a time here${call}:`,
      bookUrl,
      "",
      `— ${business.name}`,
    ].join("\n"),
  };
}

/**
 * Whether an automatic season may start itself now: automatic mode, the
 * switch on, a go-live date set and reached, and inside the season's window.
 */
export function autoStartAllowed(input: { enabled: boolean; mode: "owner" | "auto"; goLive: string | null; season: Season; now: Date }): boolean {
  if (!input.enabled || input.mode !== "auto" || !input.goLive) return false;
  if (input.now.getTime() < Date.parse(`${input.goLive}T00:00:00`)) return false;
  return inWindow(input.season, input.now);
}

/** A day's sends, capped so a season goes out over a few days rather than in one burst. */
export const SEASONAL_DAILY_CAP = 60;
