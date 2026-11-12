/**
 * How often the business posts, and the scheduler that turns approved posts
 * into times.
 *
 * A cadence is a number of posts a week for each account (Facebook and
 * Instagram) and a list of best-time slots in priority order. With 4 a week
 * on an account, that account uses the first four slots of every week. An
 * approved post with no time takes the earliest slot instance that is free
 * on every account it is for, in a week that still has room on each of them.
 *
 * Pure: when a post should go out has one right answer, whatever the
 * database holds.
 */

import { localWeekKey } from "@/lib/marketing/social-autopost";
import { BUSINESS_TIME_ZONE, dateKeyIn, zonedToUtc } from "@/lib/time-zone";

export const SOCIAL_PLATFORMS = ["facebook", "instagram"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const PLATFORM_LABEL: Record<SocialPlatform, string> = { facebook: "Facebook", instagram: "Instagram" };

export interface CadenceSlot {
  /** 0 = Sunday. */
  weekday: number;
  /** Local hour on the business's clock, 24h. */
  hour: number;
}

export interface SocialCadence {
  perWeek: Record<SocialPlatform, number>;
  /** Best times first. */
  slots: CadenceSlot[];
  /** Give approved posts with no time the next free slot. */
  autofill: boolean;
}

/** Most posts a week on one account the settings accept. */
export const MAX_PER_WEEK = 14;

/**
 * The defaults: 4 a week on each account. Tuesday mid-morning, Thursday
 * after work, Saturday morning and Sunday late afternoon are when a
 * homeowner is thinking about the yard; Wednesday and Friday lunchtime are
 * there for a fifth and sixth.
 */
export const DEFAULT_SOCIAL_CADENCE: SocialCadence = {
  perWeek: { facebook: 4, instagram: 4 },
  slots: [
    { weekday: 2, hour: 10 },
    { weekday: 4, hour: 18 },
    { weekday: 6, hour: 9 },
    { weekday: 0, hour: 17 },
    { weekday: 3, hour: 12 },
    { weekday: 5, hour: 12 },
  ],
  autofill: true,
};

/** Two posts on one account closer than this read as a bot. */
export const MIN_GAP_HOURS = 12;

/** A slot must be at least this far ahead to be handed out. */
const LEAD_MINUTES = 30;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function int(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/** Slots as saved, cleaned: whole hours, real weekdays, no repeats. */
export function tidySlots(raw: unknown): CadenceSlot[] {
  if (!Array.isArray(raw)) return DEFAULT_SOCIAL_CADENCE.slots.map((s) => ({ ...s }));
  const seen = new Set<string>();
  const out: CadenceSlot[] = [];
  for (const item of raw) {
    const s = item as { weekday?: unknown; hour?: unknown } | null;
    if (!s || typeof s !== "object") continue;
    // Out of range is dropped, not clamped: weekday 9 is not Saturday.
    const weekday = int(s.weekday, -1, -1, 99);
    const hour = int(s.hour, -1, -1, 99);
    if (weekday < 0 || weekday > 6 || hour < 0 || hour > 23) continue;
    const key = `${weekday}:${hour}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ weekday, hour });
  }
  return out.slice(0, MAX_PER_WEEK);
}

/** A cadence from a social_cadence row (or nothing), with the defaults filling gaps. */
export function tidyCadence(row: { facebook_per_week?: unknown; instagram_per_week?: unknown; slots?: unknown; autofill?: unknown } | null | undefined): SocialCadence {
  const d = DEFAULT_SOCIAL_CADENCE;
  if (!row) return { perWeek: { ...d.perWeek }, slots: d.slots.map((s) => ({ ...s })), autofill: d.autofill };
  return {
    perWeek: {
      facebook: int(row.facebook_per_week, d.perWeek.facebook, 0, MAX_PER_WEEK),
      instagram: int(row.instagram_per_week, d.perWeek.instagram, 0, MAX_PER_WEEK),
    },
    slots: tidySlots(row.slots),
    autofill: typeof row.autofill === "boolean" ? row.autofill : d.autofill,
  };
}

/** "Tue 10am", "Thu 6pm". */
export function slotLabel(slot: CadenceSlot): string {
  const h = slot.hour % 12 === 0 ? 12 : slot.hour % 12;
  return `${WEEKDAYS[slot.weekday] ?? "?"} ${h}${slot.hour < 12 ? "am" : "pm"}`;
}

/** Problems with a cadence as somebody typed it, in words. */
export function cadenceProblems(c: SocialCadence): string[] {
  const problems: string[] = [];
  const most = Math.max(c.perWeek.facebook, c.perWeek.instagram);
  if (c.slots.length === 0 && most > 0) problems.push("Add at least one posting time.");
  else if (c.slots.length < most) problems.push(`${most} a week needs ${most} posting times; there are ${c.slots.length}.`);
  return problems;
}

/** Which accounts a post can go to under this cadence: those it is for that post at all. */
export function activePlatforms(platforms: readonly string[], c: SocialCadence): SocialPlatform[] {
  return SOCIAL_PLATFORMS.filter((p) => platforms.includes(p) && c.perWeek[p] > 0);
}

export interface SlotTime {
  at: Date;
  /** Its slot's place in the priority list: 0 is the best time. */
  rank: number;
}

/** Every slot instance from `from` for `weeks` weeks, earliest first. */
export function slotTimes(c: SocialCadence, from: Date, weeks: number): SlotTime[] {
  const out: SlotTime[] = [];
  const earliest = from.getTime() + LEAD_MINUTES * 60_000;
  const startKey = dateKeyIn(from, BUSINESS_TIME_ZONE);
  const start = Date.parse(`${startKey}T12:00:00Z`);
  for (let d = 0; d < weeks * 7 + 1; d++) {
    const key = new Date(start + d * 86_400_000).toISOString().slice(0, 10);
    const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
    c.slots.forEach((slot, rank) => {
      if (slot.weekday !== weekday) return;
      const at = zonedToUtc(key, `${String(slot.hour).padStart(2, "0")}:00`, BUSINESS_TIME_ZONE);
      if (at.getTime() >= earliest) out.push({ at, rank });
    });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export interface Booking {
  at: string | Date;
  platforms: readonly string[];
}

export interface WaitingPost {
  id: string;
  platforms: readonly string[];
}

export interface Assignment {
  id: string;
  scheduledFor: string;
}

/**
 * Give approved posts their times. Posts are taken in the order given (the
 * caller passes oldest approval first) and each takes the earliest slot
 * instance that, on every account it is for:
 * - is one of that account's first `perWeek` slots,
 * - falls in a week with fewer than `perWeek` posts already, and
 * - is at least MIN_GAP_HOURS from anything else on that account.
 * A post for no active account is left alone. A post that fits nowhere in
 * the horizon waits for the next run.
 */
export function fillSlots(input: { cadence: SocialCadence; waiting: readonly WaitingPost[]; booked: readonly Booking[]; now: Date; weeks?: number }): Assignment[] {
  const { cadence: c, now } = input;
  const times = slotTimes(c, now, input.weeks ?? 6);
  const gap = MIN_GAP_HOURS * 3_600_000;

  const onPlatform: Record<SocialPlatform, number[]> = { facebook: [], instagram: [] };
  const weekCount: Record<SocialPlatform, Map<string, number>> = { facebook: new Map(), instagram: new Map() };
  const book = (at: Date, platforms: readonly SocialPlatform[]) => {
    const week = localWeekKey(at);
    for (const p of platforms) {
      onPlatform[p].push(at.getTime());
      weekCount[p].set(week, (weekCount[p].get(week) ?? 0) + 1);
    }
  };
  for (const b of input.booked) {
    const at = new Date(b.at);
    if (Number.isNaN(at.getTime())) continue;
    book(at, SOCIAL_PLATFORMS.filter((p) => b.platforms.includes(p)));
  }

  const used = new Set<number>();
  const out: Assignment[] = [];
  for (const post of input.waiting) {
    const platforms = activePlatforms(post.platforms, c);
    if (platforms.length === 0) continue;
    const fit = times.find(({ at, rank }) => {
      const t = at.getTime();
      if (used.has(t)) return false;
      const week = localWeekKey(at);
      return platforms.every(
        (p) => rank < c.perWeek[p] && (weekCount[p].get(week) ?? 0) < c.perWeek[p] && onPlatform[p].every((x) => Math.abs(x - t) >= gap)
      );
    });
    if (!fit) continue;
    used.add(fit.at.getTime());
    book(fit.at, platforms);
    out.push({ id: post.id, scheduledFor: fit.at.toISOString() });
  }
  return out;
}

/** The next `count` slot instances one account would use, for showing the plan. */
export function upcomingSlotsFor(c: SocialCadence, platform: SocialPlatform, from: Date, count: number): Date[] {
  return slotTimes(c, from, Math.ceil(count / Math.max(1, c.perWeek[platform])) + 2)
    .filter((s) => s.rank < c.perWeek[platform])
    .slice(0, count)
    .map((s) => s.at);
}
