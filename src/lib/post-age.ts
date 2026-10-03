import { BUSINESS_TIME_ZONE, dateKeyIn, zonedToUtc } from "@/lib/time-zone";

/**
 * When a post went up, and what that means for answering it.
 *
 * Facebook scrambles the little "2h" on a post so it cannot be read off the
 * page, but the full date is in the tooltip it shows when the time is
 * hovered ("Friday, September 26, 2026 at 1:04 PM"). The finder reads that,
 * or failing it whatever short label it could see, and this turns either
 * into a time. A post from yesterday or before may already have somebody,
 * so the comment says "if you haven't gotten this taken care of yet".
 *
 * Pure, so the rules are tested without a browser.
 */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function clockOf(text: string): string | null {
  const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "pm") hour += 12;
  return `${String(hour).padStart(2, "0")}:${m[2] ?? "00"}`;
}

/**
 * The time a post went up, from what the page said about it. Null when it
 * said nothing that can be read.
 *
 * Takes the tooltip's full date, "September 26 at 1:04 PM" without the
 * year, "Yesterday at 3:15 PM", and the short labels: "Just now", "12m",
 * "5h", "3d", "2w". A date is the business's local time.
 */
export function postedAtFromLabel(label: string | null | undefined, now: Date, timeZone: string = BUSINESS_TIME_ZONE): Date | null {
  const text = (label ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!text) return null;

  if (/^(just now|now|a few seconds ago)\b/.test(text)) return now;
  const relative = text.match(/^(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|wk|wks|weeks?|y|yr|yrs|years?)\b(\s+ago)?$/);
  if (relative) {
    const n = Number(relative[1]);
    const unit = relative[2];
    const ms = /^s/.test(unit)
      ? n * 1000
      : /^(m|min)/.test(unit)
        ? n * 60_000
        : /^h/.test(unit)
          ? n * HOUR
          : /^d/.test(unit)
            ? n * DAY
            : /^w/.test(unit)
              ? n * 7 * DAY
              : n * 365 * DAY;
    return new Date(now.getTime() - ms);
  }

  const clock = clockOf(text) ?? "12:00";
  if (/^today\b/.test(text)) return zonedToUtc(dateKeyIn(now, timeZone), clock, timeZone);
  if (/^yesterday\b/.test(text)) return zonedToUtc(dateKeyIn(new Date(now.getTime() - DAY), timeZone), clock, timeZone);

  // "Friday, September 26, 2026 at 1:04 PM", "Sep 26 at 1:04 PM".
  const dated = text.replace(/^[a-z]+day,?\s+/, "").match(/^([a-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/);
  if (dated) {
    const month = MONTHS.indexOf(dated[1].slice(0, 3));
    if (month >= 0) {
      const today = dateKeyIn(now, timeZone);
      let year = dated[3] ? Number(dated[3]) : Number(today.slice(0, 4));
      const key = (y: number) => `${y}-${String(month + 1).padStart(2, "0")}-${String(Number(dated[2])).padStart(2, "0")}`;
      let when = zonedToUtc(key(year), clock, timeZone);
      // No year and a date still to come: it was last year's.
      if (!dated[3] && when.getTime() > now.getTime() + DAY) {
        year -= 1;
        when = zonedToUtc(key(year), clock, timeZone);
      }
      return Number.isNaN(when.getTime()) ? null : when;
    }
  }
  return null;
}

/** Whole days since it went up, from a time or from the age read when it was found. */
export function daysOld(postedAt: string | null, ageDaysWhenFound: number | null, foundAt: string, now: Date): number | null {
  if (postedAt) return Math.max(0, Math.floor((now.getTime() - new Date(postedAt).getTime()) / DAY));
  if (ageDaysWhenFound == null) return null;
  return ageDaysWhenFound + Math.max(0, Math.floor((now.getTime() - new Date(foundAt).getTime()) / DAY));
}

export type Freshness = "fresh" | "aging" | "old" | "unknown";

/**
 * How the card says the post's age. Fresh is under a day; a day or two and
 * they may still need somebody; three days and more, they may have found
 * someone already. Unknown when the post showed no time, and it says so
 * rather than guess.
 */
export function describeAge(postedAt: string | null, foundAt: string, now: Date): { freshness: Freshness; label: string; hint: string } {
  if (!postedAt) {
    return {
      freshness: "unknown",
      label: `Found ${ago(now.getTime() - new Date(foundAt).getTime())}`,
      hint: "The post didn't show when it went up. Check the date on it before answering.",
    };
  }
  const ms = Math.max(0, now.getTime() - new Date(postedAt).getTime());
  const label = `Posted ${ago(ms)}`;
  if (ms < DAY) return { freshness: "fresh", label, hint: "Fresh. They're likely still looking." };
  if (ms < 3 * DAY) return { freshness: "aging", label, hint: "A day or two old. The comment asks if they still need someone." };
  return { freshness: "old", label, hint: "A few days old. They may have found someone; the comment asks if they still need help." };
}

function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} weeks ago`;
}

/** Said before "I operate…" on a post from yesterday or before. */
export const STILL_NEED_OPENER = "If you haven't gotten this taken care of yet, ";

/**
 * The comment's opening, set by how old the post really is rather than by
 * how old it looked in the picture. A day old or more: it asks whether they
 * still need someone. Newer: straight in. Unknown: left as written.
 */
export function fitOpenerToAge(comment: string, days: number | null): string {
  if (days == null) return comment;
  const text = comment.trimStart();
  const asks = /^if you (haven'?t|have not|still)\b[^,.!]*,\s*/i;
  if (days >= 1) {
    if (asks.test(text)) return text;
    // "I operate JS Landscaping" stays "I"; anything else is lower-cased.
    const rest = /^I\b/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1);
    return STILL_NEED_OPENER + rest;
  }
  if (!asks.test(text)) return text;
  const rest = text.replace(asks, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}
