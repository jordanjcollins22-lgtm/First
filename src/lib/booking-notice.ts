/**
 * How much warning an evaluation needs.
 *
 * The booking page used to offer any free hour from about now, so somebody
 * booking at 11am could land on the calendar at 2pm the same day, on a day
 * the evaluator had already planned around something else. Two rules, both
 * the business's to set: a minimum number of hours between booking and
 * visit, and whether the same day is ever offered at all.
 *
 * "Same day" is a calendar question, not an arithmetic one, so it is asked
 * in the business's own time zone. A booking at 11pm Eastern is still
 * "today" there even though it is already tomorrow in UTC, and the earliest
 * visit is the day after, not the one that has just started on the server's
 * clock.
 */

export interface BookingNotice {
  /** Fewest hours between booking and visit. */
  noticeHours: number;
  /** Whether a visit later today may be offered at all. */
  sameDay: boolean;
  /** The business's clock, for deciding what "today" means. */
  timeZone: string;
}

export const DEFAULT_NOTICE: BookingNotice = { noticeHours: 0, sameDay: false, timeZone: "America/New_York" };

/** The most hours of notice that still reads as notice rather than a closed book. */
export const MAX_NOTICE_HOURS = 720;

/** YYYY-MM-DD of an instant, on the given clock. */
export function dayKeyIn(at: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(at);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    // An unknown zone name falls back to the server's clock rather than to
    // nothing: a wrong "today" is recoverable, a page with no times is not.
    return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  }
}

function nextDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

/**
 * The first calendar day a visit may be offered on.
 *
 * Today on the business's clock when same-day is allowed, otherwise
 * tomorrow. Hours of notice can push it later still, and the later of the
 * two wins: 48 hours of notice at 10am on Monday means Wednesday, whatever
 * the same-day rule says.
 */
export function firstBookableDate(notice: BookingNotice, now: Date): string {
  const today = dayKeyIn(now, notice.timeZone);
  const byDay = notice.sameDay ? today : nextDayKey(today);
  const byHours = dayKeyIn(new Date(now.getTime() + notice.noticeHours * 3_600_000), notice.timeZone);
  return byDay > byHours ? byDay : byHours;
}

/** Minutes of lead the slot search should insist on, never less than the hour it always had. */
export function minLeadMinutes(notice: BookingNotice): number {
  return Math.max(60, Math.round(notice.noticeHours * 60));
}

/**
 * Why a chosen time is too soon, or null when it is fine.
 *
 * Checked again at submit rather than only when the times were drawn: a
 * booking page can sit open on somebody's phone overnight, and the slot
 * that was tomorrow when they opened it is today when they press the button.
 */
export function tooSoon(
  notice: BookingNotice,
  now: Date,
  chosen: { date: string; at: Date }
): string | null {
  const first = firstBookableDate(notice, now);
  if (chosen.date < first) {
    return notice.sameDay
      ? "That time is too soon. Pick a later one."
      : "We can't come out the same day you book. Pick a time from tomorrow on.";
  }
  if (chosen.at.getTime() < now.getTime() + minLeadMinutes(notice) * 60_000) {
    const hours = Math.max(1, Math.round(minLeadMinutes(notice) / 60));
    return `We need at least ${hours} hour${hours === 1 ? "" : "s"} notice. Pick a later time.`;
  }
  return null;
}

/** The rule in the client's words, for the booking page. */
export function describeNotice(notice: BookingNotice): string {
  const parts: string[] = [];
  if (!notice.sameDay) parts.push("The earliest visit is tomorrow");
  if (notice.noticeHours > 0) {
    const days = notice.noticeHours / 24;
    const span = Number.isInteger(days) && days >= 1 ? `${days} day${days === 1 ? "" : "s"}` : `${notice.noticeHours} hours`;
    parts.push(parts.length > 0 ? `and at least ${span} after you book` : `Visits need at least ${span} notice`);
  }
  if (parts.length === 0) return "";
  return `${parts.join(" ")}.`;
}

/** The rule in the office's words, for the settings screen. */
export function describeNoticeForOffice(notice: BookingNotice): string {
  const day = notice.sameDay ? "Same-day visits can be booked" : "Same-day visits are never offered";
  const hours =
    notice.noticeHours > 0
      ? `, and nothing inside ${notice.noticeHours} hour${notice.noticeHours === 1 ? "" : "s"} of booking`
      : "";
  return `${day}${hours}. Days are judged on ${notice.timeZone.replace(/_/g, " ")} time.`;
}

/** What somebody typed into the hours box, as a number the rule accepts. */
export function parseNoticeHours(raw: string | number): number | null {
  const value = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(value) || value < 0 || value > MAX_NOTICE_HOURS) return null;
  return Math.round(value);
}
