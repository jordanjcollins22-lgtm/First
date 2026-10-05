/**
 * Cold email to local property management companies: the rules that do not
 * need a database. Pulling an email off a company's website and picking the
 * one to write to, when each email in the sequence goes out, the footer
 * every cold email has to carry, and what the email leads with in each
 * season. Pure, so all of it is tested.
 */

import { BUSINESS_TIME_ZONE, dateKeyIn, zonedToUtc } from "@/lib/time-zone";

// ---------------------------------------------------------------------------
// Finding the address to write to
// ---------------------------------------------------------------------------

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi;
const JUNK = /\.(png|jpe?g|gif|svg|webp|css|js)$|@(example|domain|email|yourdomain|sentry|wixpress|sentry-next)\.|^(no-?reply|donotreply|postmaster|abuse|webmaster)@/i;

/** Every email address written on a page, tidy and once each. */
export function extractEmails(html: string): string[] {
  const text = (html ?? "").replace(/&#64;|&#x40;|\[at\]|\(at\)/gi, "@").replace(/%40/g, "@");
  const found = new Set<string>();
  for (const match of text.match(EMAIL_RE) ?? []) {
    const email = match.toLowerCase().replace(/^mailto:/, "").replace(/[.,;:]+$/, "");
    if (!JUNK.test(email) && email.length <= 120) found.add(email);
  }
  return [...found];
}

/** The site's own domain, without www. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Addresses for tenants and job seekers, not for whoever hires contractors. */
const NOT_FOR_US = /^(careers?|jobs|hr|apply|applications?|rent|rental|payments?|billing|accounting|ar|ap|tenants?|residents?|leasing|renters?|maintenance|repairs?|workorders?|support|help)\b/;
/** Addresses that reach the office. */
const OFFICE = /^(info|office|contact|hello|admin|manager|management|owner|owners|operations|ops|vendors?|partners?)\b/;

/**
 * The one address to write to: on the company's own domain first, the
 * office over a person's guessable inbox, and never the tenant or careers
 * inboxes. Null when nothing suitable was found.
 */
export function bestEmail(emails: string[], site: string | null): string | null {
  const host = hostOf(site);
  const score = (email: string) => {
    const [local, domain] = email.split("@");
    if (NOT_FOR_US.test(local)) return -1;
    let s = 0;
    if (host && (domain === host || domain.endsWith(`.${host}`))) s += 10;
    if (OFFICE.test(local)) s += 5;
    else if (/^[a-z]+(\.[a-z]+)?$/.test(local)) s += 3;
    if (/gmail|yahoo|aol|hotmail|outlook|comcast|verizon/.test(domain)) s += 1;
    return s;
  };
  const ranked = emails.map((e) => ({ e, s: score(e) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s);
  return ranked[0]?.e ?? null;
}

/** The pages of a site worth reading for an email, in order. */
export const CONTACT_PATHS = ["", "/contact", "/contact-us", "/about", "/about-us", "/owners", "/vendors"];

// ---------------------------------------------------------------------------
// When each email goes out
// ---------------------------------------------------------------------------

/** Business days after the first email that each later one waits. */
export const STEP_DELAYS = [0, 3, 7];

/** Weekdays only, mid-morning to mid-afternoon on the business's clock. */
export const SEND_FROM_HOUR = 8;
export const SEND_TO_HOUR = 16;

function weekdayOf(date: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: BUSINESS_TIME_ZONE }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

function hourOf(date: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: BUSINESS_TIME_ZONE }).format(date));
}

/** Whether emails may go out right now: a weekday, inside the sending hours. */
export function inSendWindow(now: Date): boolean {
  const day = weekdayOf(now);
  const hour = hourOf(now);
  return day >= 1 && day <= 5 && hour >= SEND_FROM_HOUR && hour < SEND_TO_HOUR;
}

/** A spread of minutes for one company, so a batch does not all leave at once. */
function minuteFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % 150;
}

/**
 * When each step of a company's sequence may go out: the first in the next
 * sending window, each later one so many business days after, all at the
 * same spread-out time of morning for that company.
 */
export function stepSchedule(start: Date, seed: string): Date[] {
  const minute = minuteFor(seed);
  const at = (date: Date) => {
    const key = dateKeyIn(date, BUSINESS_TIME_ZONE);
    const hh = String(9 + Math.floor(minute / 60)).padStart(2, "0");
    const mm = String(minute % 60).padStart(2, "0");
    return zonedToUtc(key, `${hh}:${mm}`, BUSINESS_TIME_ZONE);
  };
  const nextWeekday = (date: Date) => {
    let d = new Date(date);
    while (weekdayOf(d) === 0 || weekdayOf(d) === 6) d = new Date(d.getTime() + 86_400_000);
    return d;
  };
  // The first one goes today if today's slot is still ahead, else the next weekday.
  let first = nextWeekday(start);
  if (at(first).getTime() <= start.getTime()) first = nextWeekday(new Date(first.getTime() + 86_400_000));
  return STEP_DELAYS.map((days) => {
    let d = first;
    for (let i = 0; i < days; i += 1) d = nextWeekday(new Date(d.getTime() + 86_400_000));
    return at(d);
  });
}

// ---------------------------------------------------------------------------
// What every cold email carries, and what it leads with
// ---------------------------------------------------------------------------

/**
 * The footer the law asks for on a commercial email: who it is from, where
 * the business is, and a working way to stop the emails.
 */
export function emailFooter(input: { businessName: string; address: string; unsubscribeUrl: string }): string {
  return [`--`, `${input.businessName} · ${input.address}`, `Don't want to hear from us? ${input.unsubscribeUrl}`].join("\n");
}

export type Season = "snow" | "spring" | "summer" | "fall";

/** What the emails lead with: snow from October through February, then the season's yard work. */
export function seasonFor(date: Date): Season {
  const month = Number(new Intl.DateTimeFormat("en-US", { month: "numeric", timeZone: BUSINESS_TIME_ZONE }).format(date));
  if (month >= 10 || month <= 2) return "snow";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "fall";
}

export const SEASON_ANGLE: Record<Season, string> = {
  snow: "Lead with snow removal and salting for this winter: property managers sign snow contracts in the fall, before the first storm, and want somebody who will actually show up at 5am. Mention lawn and landscaping second, for spring.",
  spring: "Lead with spring cleanups, mulch and bed work, and getting lawns on a regular schedule before tenants and owners notice.",
  summer: "Lead with reliable weekly lawn care and trimming across their properties, with photos after every visit so they never have to drive by to check.",
  fall: "Lead with leaf and fall cleanups, and mention that we are booking snow removal contracts for the winter now.",
};

/** Whether the business can legally send at all: an address to put in the footer. */
export function sendBlocker(input: { sendingOn: boolean; mailbox: boolean; address: string | null }): string | null {
  if (!input.address?.trim()) return "Add the business's street address in Settings first. Every cold email has to carry it.";
  if (!input.mailbox) return "Connect the sending mailbox first (a separate domain for cold email).";
  if (!input.sendingOn) return "Sending is switched off.";
  return null;
}

/**
 * How many may go today. A new mailbox starts small and builds up a few a
 * day, because a domain that goes from nothing to dozens of cold emails is
 * what mail providers send to spam. Never more than the owner's cap.
 */
export function allowedToday(input: { cap: number; firstSentAt: string | null; sentToday: number; now: Date }): number {
  const days = input.firstSentAt ? Math.max(0, Math.floor((input.now.getTime() - new Date(input.firstSentAt).getTime()) / 86_400_000)) : 0;
  const ramp = 5 + 3 * days;
  return Math.max(0, Math.min(input.cap, ramp) - input.sentToday);
}
