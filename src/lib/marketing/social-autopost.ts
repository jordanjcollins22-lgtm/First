/**
 * Facebook posts that schedule themselves from the crew's photos, and
 * posts that never sit stuck in the past.
 *
 * A job whose photos a manager signed off has a before and an after of the
 * same patch of ground. That pair becomes a post on its own, at the next
 * free slot, at most N a week (twice by default) counting every post the
 * page already has that week, so the owner's own posts and the app's never
 * pile up on one Tuesday.
 *
 * A post whose slot passed without going out (nothing was connected, or
 * Facebook refused it) is moved to the next free slot instead of being left
 * in the past, where nobody looks.
 *
 * Pure. Slot rules are social-post.ts's; this only adds the weekly cap.
 */

import { nextPostSlot, POSTING_TIMEZONE } from "@/lib/social-post";

/** "2026-W41"-style key for the local week (Monday start) a moment falls in. */
export function localWeekKey(at: Date | string): string {
  const d = new Date(at);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: POSTING_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  const local = new Date(Date.UTC(y, m - 1, day));
  // Monday of that week, as a date: the key.
  const dow = (local.getUTCDay() + 6) % 7;
  local.setUTCDate(local.getUTCDate() - dow);
  return local.toISOString().slice(0, 10);
}

/** The local calendar day (YYYY-MM-DD) a moment falls on, for plan_day. */
export function localDay(at: Date | string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: POSTING_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
  return parts;
}

/**
 * The next free slot in a week that has room. Walks forward a slot at a
 * time; a week already holding `perWeek` posts is skipped whole.
 */
export function nextCappedSlot(booked: readonly (string | Date)[], perWeek: number, from: Date = new Date()): Date | null {
  const counts = new Map<string, number>();
  for (const b of booked) {
    const k = localWeekKey(b);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let cursor = new Date(from);
  for (let i = 0; i < 60; i++) {
    const slot = nextPostSlot([...booked], cursor);
    if (!slot) return null;
    if ((counts.get(localWeekKey(slot)) ?? 0) < perWeek) return slot;
    // That week is full: try again from just after this slot.
    cursor = new Date(slot.getTime() + 3_600_000);
  }
  return null;
}

export interface ScheduledPost {
  id: string;
  scheduledFor: string;
}

/**
 * New times for posts whose slot passed more than `graceHours` ago. Each
 * takes the next free slot after the ones already handed out, so five stuck
 * posts spread out instead of all landing on the next Tuesday.
 */
export function reslotOverdue(
  overdue: readonly ScheduledPost[],
  upcoming: readonly string[],
  now: Date,
  graceHours = 24
): { id: string; scheduledFor: string }[] {
  const cutoff = now.getTime() - graceHours * 3_600_000;
  const stuck = overdue.filter((p) => Date.parse(p.scheduledFor) < cutoff).sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  const taken = [...upcoming];
  const out: { id: string; scheduledFor: string }[] = [];
  for (const post of stuck) {
    const slot = nextPostSlot(taken, now);
    if (!slot) break;
    taken.push(slot.toISOString());
    out.push({ id: post.id, scheduledFor: slot.toISOString() });
  }
  return out;
}
