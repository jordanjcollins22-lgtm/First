/**
 * The week's posts: what each one carries and the rules it keeps. A post
 * is a hook (the first line, the one that stops the scroll), the main text,
 * one call to action with the tracked link, and three to five hashtags
 * that say the service and the town. Pure, so the rules are tested.
 */

import { BUSINESS_TIME_ZONE, zonedToUtc } from "@/lib/time-zone";

export type PlanKind = "openings" | "story" | "before-after" | "snow" | "process" | "local";

export const PLAN_KIND_LABEL: Record<PlanKind, string> = {
  openings: "Openings",
  story: "Our story",
  "before-after": "Before and after",
  snow: "Snow",
  process: "How it works",
  local: "Local",
};

/** How the picture is drawn: one photo, a before and after side by side, or the brand colours alone. */
export type CardStyle = "photo" | "split" | "brand";

/** When a planned post goes out on its day: mid-morning, when the daily timer runs. */
export const PLAN_POST_TIME = "10:00";

export interface PlanText {
  hook: string;
  body: string;
  cta: string;
  hashtags: string[];
}

/** The link put into the call to action, in place of {link}. */
export function composePlanCaption(post: PlanText, link: string | null): string {
  const cta = post.cta.replace(/\{link\}/g, link ?? "").replace(/\s+:\s*$/, "").trim();
  const tags = cleanHashtags(post.hashtags).join(" ");
  return [post.hook.trim(), post.body.trim(), cta, tags].filter(Boolean).join("\n\n");
}

/** Hashtags as one word each with a #, no repeats, five at most. */
export function cleanHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const word = raw.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (!word || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    out.push(`#${word}`);
  }
  return out.slice(0, 5);
}

/** What would stop a post going out as written. */
export function planProblems(post: PlanText): string[] {
  const problems: string[] = [];
  const all = `${post.hook}\n${post.body}\n${post.cta}`;
  if (!post.hook.trim()) problems.push("It needs a hook.");
  if (post.hook.length > 110) problems.push("The hook is long: keep it to one short line.");
  if (!post.cta.trim()) problems.push("It needs a call to action.");
  if (/\$\s?\d/.test(all)) problems.push("It names a price.");
  if (/\b(licensed|insured|bonded|certified)\b/i.test(all)) problems.push("It claims a licence or insurance.");
  const tags = cleanHashtags(post.hashtags);
  if (tags.length < 3) problems.push("Give it three to five hashtags.");
  return problems;
}

/** When a planned post goes out: its day at the posting time, or the next run if that has passed. */
export function planSlot(day: string, now: Date): Date {
  const at = zonedToUtc(day, PLAN_POST_TIME, BUSINESS_TIME_ZONE);
  return at.getTime() > now.getTime() ? at : now;
}

/** Monday of the week `now` falls in, on the business's clock, as YYYY-MM-DD. */
export function weekStart(now: Date): string {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE }).format(now);
  const day = new Date(`${key}T12:00:00Z`);
  const back = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}
