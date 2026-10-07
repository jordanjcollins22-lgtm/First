/**
 * Whether the post finder has quietly stopped, and what to tell the owner.
 *
 * The finder runs in Chrome on a laptop: it checks in with the app every
 * minute and reads Facebook every minute or so. A laptop that sleeps, a
 * window that gets minimized, a Chrome that closes or a Facebook that signs
 * out all stop it, and nothing used to say so. This is the check, run on
 * the finder's own server timer, and it only speaks while the finder is
 * meant to be running: switched on, inside its looking hours, and not in
 * the first minutes after either of those began.
 *
 * Pure, so each case is tested without a clock or a database.
 */

export type FinderProblem = "not_running" | "not_reading" | "no_links";

/** Quiet for this long, while it should be running, is stopped. */
export const STOPPED_AFTER_MINUTES = 20;
/** This many posts about the work in a day with no link to any of them is a broken look, not a quiet day. */
export const NO_LINKS_AFTER = 8;

export interface FinderWatchInput {
  now: Date;
  /** Switched on, and inside its looking hours. */
  shouldRun: boolean;
  /** Minutes since the looking hours began today, or since it was switched on, whichever is later. */
  minutesRunning: number;
  /** The extension's last check-in, from any Chrome. */
  extensionSeenAt: string | null;
  /** The last look that sent what it read. */
  lastLookAt: string | null;
  /** Today's posts from the finder about the work, and how many had their own link. */
  matchedToday: number;
  linkedToday: number;
  /** "2026-09-30", the business's today, for keying the once-a-day message. */
  today: string;
  timeZone: string;
}

export interface FinderAlert {
  problem: FinderProblem;
  text: string;
  /** One message per stop: the same stop is not texted twice. */
  dedupeKey: string;
}

function minutesSince(iso: string | null, now: Date): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? (now.getTime() - t) / 60_000 : Number.POSITIVE_INFINITY;
}

function clock(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
}

export function finderAlert(input: FinderWatchInput): FinderAlert | null {
  if (!input.shouldRun || input.minutesRunning < STOPPED_AFTER_MINUTES) return null;

  if (minutesSince(input.extensionSeenAt, input.now) >= STOPPED_AFTER_MINUTES) {
    const since = input.extensionSeenAt ? ` since ${clock(input.extensionSeenAt, input.timeZone)}` : "";
    return {
      problem: "not_running",
      text:
        `The post finder has stopped: the laptop hasn't checked in${since}. ` +
        "Check the laptop is awake and plugged in, Chrome is open, and the finder window is on screen, not minimized.",
      dedupeKey: `finder-stopped:${input.extensionSeenAt ?? input.today}`,
    };
  }

  if (minutesSince(input.lastLookAt, input.now) >= STOPPED_AFTER_MINUTES) {
    const since = input.lastLookAt ? ` since ${clock(input.lastLookAt, input.timeZone)}` : " today";
    return {
      problem: "not_reading",
      text:
        `The post finder is on but hasn't read Facebook${since}. ` +
        "Chrome is open, so check the finder window isn't minimized and Facebook is still signed in.",
      dedupeKey: `finder-not-reading:${input.lastLookAt ?? input.today}`,
    };
  }

  if (input.matchedToday >= NO_LINKS_AFTER && input.linkedToday === 0) {
    return {
      problem: "no_links",
      text:
        `The post finder read ${input.matchedToday} posts about the work today but got a link for none of them, so none reached the affiliates. ` +
        "Facebook's page has probably changed. The last look is on Where Posts Come From.",
      dedupeKey: `finder-no-links:${input.today}`,
    };
  }

  return null;
}

/** Minutes since the looking hours began today, by the business's clock ("HH:MM" each). */
export function minutesIntoHours(clockNow: string, activeFrom: string): number {
  const minutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  return (minutes(clockNow) - minutes(activeFrom) + 1440) % 1440;
}
