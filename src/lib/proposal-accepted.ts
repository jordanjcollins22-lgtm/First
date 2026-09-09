/**
 * When a client answered a proposal, worded once.
 *
 * The timestamp has always been recorded. Nothing showed it, so "when did
 * they sign?" was a question the office answered from memory or from an email
 * in somebody's inbox — and the answer decides when the deposit was due, when
 * the crew could be booked and which week the sale belongs to.
 *
 * Formatted in the business's own timezone, explicitly, rather than in
 * whatever clock the machine doing the rendering happens to keep. A server
 * runs on UTC, so a proposal accepted at nine on Monday evening renders as one
 * in the morning on Tuesday: the wrong time on the wrong day. Stating the zone
 * also means the page reads the same whether it was drawn on the server or in
 * the browser, which is the other way this goes wrong.
 */

/** The clock the office keeps, when the organization has not set one. */
export const FALLBACK_TIME_ZONE = "America/New_York";

export interface RespondedMoment {
  /** "Tue, Sep 9, 2026" */
  day: string;
  /** "2:14 PM" */
  time: string;
  /** "EDT" — which clock, so nobody has to guess. */
  zone: string;
  /** The raw timestamp, for a <time dateTime>. */
  iso: string;
}

/**
 * The day and time a client answered, or null if they have not.
 *
 * Null rather than a placeholder: a proposal nobody has answered has no
 * answer time, and "—" printed where a date goes is something somebody reads
 * as a bug in the clock rather than as an unanswered proposal.
 */
export function respondedMoment(
  iso: string | null | undefined,
  timeZone?: string | null
): RespondedMoment | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;

  const zone = usableZone(timeZone);
  const parts = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { ...options, timeZone: zone }).format(at);

  return {
    day: parts({ weekday: "short", month: "short", day: "numeric", year: "numeric" }),
    time: parts({ hour: "numeric", minute: "2-digit" }),
    zone: zoneAbbreviation(at, zone),
    iso,
  };
}

/**
 * The whole sentence: what they did, on what day, at what time.
 *
 * Takes the status rather than assuming acceptance, because the same
 * timestamp records a decline and a screen that calls one the other is worse
 * than a screen that shows neither.
 */
export function responseLabel(
  status: string | null | undefined,
  iso: string | null | undefined,
  timeZone?: string | null
): string | null {
  const moment = respondedMoment(iso, timeZone);
  if (!moment) return null;
  const verb = status === "accepted" ? "Accepted" : status === "declined" ? "Declined" : "Answered";
  return `${verb} ${moment.day} at ${moment.time} ${moment.zone}`;
}

/** The same fact with the year and the weekday dropped, for a tight space. */
export function responseShort(
  iso: string | null | undefined,
  timeZone?: string | null
): string | null {
  const moment = respondedMoment(iso, timeZone);
  if (!moment) return null;
  return `${moment.day.replace(/^\w+,\s*/, "").replace(/,\s*\d{4}$/, "")}, ${moment.time}`;
}

/**
 * A timezone the runtime will actually accept.
 *
 * A bad zone throws from Intl rather than falling back, and an organization
 * row carrying a typo would take out every screen that shows a date. Checked
 * once, here.
 */
function usableZone(timeZone: string | null | undefined): string {
  const wanted = (timeZone ?? "").trim();
  if (!wanted) return FALLBACK_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: wanted }).format(new Date());
    return wanted;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

/** "EDT" or "EST", whichever was in force at that moment. */
function zoneAbbreviation(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(at);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
}
