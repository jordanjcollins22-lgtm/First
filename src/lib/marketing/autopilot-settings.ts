/**
 * The marketing autopilot's switches, and the rule that keeps a switch from
 * sweeping the backlog.
 *
 * Every automation here has an on/off setting and remembers when it was first
 * switched on. It acts only on records made or changed after that moment, so
 * turning reviews on does not reply to three years of reviews and turning the
 * seasonal email on does not mail everyone who ever paid. A one-off, started
 * by the owner on purpose, is the only way past that line.
 *
 * Stored as one JSON document per business (marketing_autopilot_settings).
 * Read through normalizeAutopilot every time, so a missing key or a value of
 * the wrong shape falls back to its default instead of breaking a run.
 *
 * Pure.
 */

export const AUTOMATIONS = [
  "plays_auto_approve",
  "hangers_default_approve",
  "plays_auto_close",
  "plays_expire",
  "review_replies",
  "gbp_weekly_post",
  "social_autopost",
  "social_reslot",
  "seasonal_email",
  "rank_weekly",
  "ads_import",
] as const;

export type Automation = (typeof AUTOMATIONS)[number];

export const AUTOMATION_LABEL: Record<Automation, string> = {
  plays_auto_approve: "Approve plays like the last 3",
  hangers_default_approve: "Approve door hangers round active jobs",
  plays_auto_close: "Close plays when walked, finished or tapped done",
  plays_expire: "Expire plays untouched for 30 days",
  review_replies: "Reply to Google reviews (4-5 stars post, 1-3 wait)",
  gbp_weekly_post: "Weekly Google post from approved photos",
  social_autopost: "Schedule Facebook posts from crew-approved photos",
  social_reslot: "Move overdue posts to the next free slot",
  seasonal_email: "Seasonal cross-sell email to past clients",
  rank_weekly: "Weekly rank check",
  ads_import: "Daily Google Ads and LSA spend import",
};

/**
 * Which are on before the owner touches anything. Only the ones that change
 * nothing outside the app: approving and closing the business's own to-do
 * list. Anything that publishes, posts or emails starts off.
 */
export const DEFAULT_ON: Record<Automation, boolean> = {
  plays_auto_approve: true,
  hangers_default_approve: true,
  plays_auto_close: true,
  plays_expire: true,
  review_replies: false,
  gbp_weekly_post: false,
  social_autopost: false,
  social_reslot: true,
  seasonal_email: false,
  rank_weekly: false,
  ads_import: true,
};

export type PlayKindCost = "yard_sign" | "knocks" | "door_hangers" | "flyers";

export interface AutopilotSettings {
  enabled: Record<Automation, boolean>;
  /** Cents per piece, stamped on a play when it closes. */
  unitCostCents: Record<PlayKindCost, number>;
  /** Days an open play may sit untouched before it expires. */
  playExpiryDays: number;
  /** Share of a round's doors the trail must pass within reach of. */
  gpsCoverage: number;
  /** Facebook posts a week the app schedules from crew photos. */
  socialPostsPerWeek: number;
  /** Seasonal email: the owner starts each one after a preview, or it starts itself. */
  seasonalMode: "owner" | "auto";
  /** Automatic seasonal sends wait until this date (YYYY-MM-DD) even when on. */
  seasonalGoLive: string | null;
  /** Towns the rank tracker and the area pages cover. */
  rankTowns: string[];
  /** Services crossed with the towns for the rank tracker's phrases. */
  rankServices: string[];
  /** Phrases checked per weekly run, oldest-checked first, to cap API cost. */
  rankPerWeek: number;
  /** Marketing spend as a share of revenue, the target band. */
  spendTargetLow: number;
  spendTargetHigh: number;
}

export const HARFORD_TOWNS = [
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

export const CORE_SERVICES = ["lawn care", "landscaping", "mulching", "snow removal"] as const;

export const DEFAULT_AUTOPILOT: AutopilotSettings = {
  enabled: { ...DEFAULT_ON },
  // Print plus a walker's pay per door, roughly; EDDM is USPS postage plus print.
  unitCostCents: { yard_sign: 800, knocks: 0, door_hangers: 25, flyers: 45 },
  playExpiryDays: 30,
  gpsCoverage: 0.8,
  socialPostsPerWeek: 2,
  seasonalMode: "owner",
  seasonalGoLive: null,
  rankTowns: [...HARFORD_TOWNS],
  rankServices: [...CORE_SERVICES],
  rankPerWeek: 10,
  spendTargetLow: 0.05,
  spendTargetHigh: 0.1,
};

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function words(value: unknown, fallback: string[], max: number): string[] {
  if (!Array.isArray(value)) return fallback;
  const out = value
    .map((v) => (typeof v === "string" ? v.trim().slice(0, 60) : ""))
    .filter(Boolean);
  return [...new Set(out)].slice(0, max);
}

/** The stored document, made safe to use. */
export function normalizeAutopilot(stored: unknown): AutopilotSettings {
  const s = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const d = DEFAULT_AUTOPILOT;
  const en = s.enabled && typeof s.enabled === "object" ? (s.enabled as Record<string, unknown>) : {};
  const enabled = Object.fromEntries(
    AUTOMATIONS.map((k) => [k, typeof en[k] === "boolean" ? (en[k] as boolean) : d.enabled[k]])
  ) as Record<Automation, boolean>;
  const uc = s.unitCostCents && typeof s.unitCostCents === "object" ? (s.unitCostCents as Record<string, unknown>) : {};
  const goLive = typeof s.seasonalGoLive === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.seasonalGoLive) ? s.seasonalGoLive : null;
  const low = num(s.spendTargetLow, d.spendTargetLow, 0, 1);
  const high = num(s.spendTargetHigh, d.spendTargetHigh, 0, 1);
  return {
    enabled,
    unitCostCents: {
      yard_sign: Math.round(num(uc.yard_sign, d.unitCostCents.yard_sign, 0, 100_000)),
      knocks: Math.round(num(uc.knocks, d.unitCostCents.knocks, 0, 100_000)),
      door_hangers: Math.round(num(uc.door_hangers, d.unitCostCents.door_hangers, 0, 100_000)),
      flyers: Math.round(num(uc.flyers, d.unitCostCents.flyers, 0, 100_000)),
    },
    playExpiryDays: Math.round(num(s.playExpiryDays, d.playExpiryDays, 7, 365)),
    gpsCoverage: num(s.gpsCoverage, d.gpsCoverage, 0.3, 1),
    socialPostsPerWeek: Math.round(num(s.socialPostsPerWeek, d.socialPostsPerWeek, 1, 6)),
    seasonalMode: s.seasonalMode === "auto" ? "auto" : "owner",
    seasonalGoLive: goLive,
    rankTowns: words(s.rankTowns, d.rankTowns, 30),
    rankServices: words(s.rankServices, d.rankServices, 12),
    rankPerWeek: Math.round(num(s.rankPerWeek, d.rankPerWeek, 1, 100)),
    spendTargetLow: Math.min(low, high),
    spendTargetHigh: Math.max(low, high),
  };
}

export type StartedMap = Partial<Record<Automation, string>>;

export function normalizeStarted(stored: unknown): StartedMap {
  const s = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const out: StartedMap = {};
  for (const k of AUTOMATIONS) {
    const v = s[k];
    if (typeof v === "string" && Number.isFinite(Date.parse(v))) out[k] = v;
  }
  return out;
}

/**
 * The started map after a save: an automation switched on for the first
 * time gets this moment; one already started keeps its moment even if it
 * was switched off and on again, because "first switched on" is the line.
 */
export function stampStarted(settings: AutopilotSettings, started: StartedMap, now: Date): { started: StartedMap; changed: boolean } {
  const next: StartedMap = { ...started };
  let changed = false;
  for (const k of AUTOMATIONS) {
    if (settings.enabled[k] && !next[k]) {
      next[k] = now.toISOString();
      changed = true;
    }
  }
  return { started: next, changed };
}

/** Whether an automation may act on a record made or changed at `at`. */
export function mayActOn(automation: Automation, settings: AutopilotSettings, started: StartedMap, at: string | null | undefined): boolean {
  if (!settings.enabled[automation]) return false;
  const since = started[automation];
  if (!since || !at) return false;
  return Date.parse(at) >= Date.parse(since);
}
