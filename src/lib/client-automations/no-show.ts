/**
 * No-show and client-cancel rebooking.
 *
 * The app records a visit that did not happen one way: evaluation_status
 * 'cancelled', with cancellation_reason as typed by whoever cancelled it (the
 * schedule panel's free-text reason) or "No-show in GoHighLevel." /
 * "Cancelled in GoHighLevel." from the calendar pull. That reason is the only
 * record of *who* called it off, so it is read here, carefully: a rebook link
 * to somebody the office cancelled as a duplicate, a test or out of area is
 * exactly the kind of message the owner declined 35 times. Anything that
 * does not clearly say the client missed it or the client cancelled is left
 * alone.
 *
 * Pure.
 */

export type MissedVisitKind = "no_show" | "client_cancelled";

const OFFICE = /duplicate|dupe|\btest\b|spam|wrong (number|address)|out of (area|range)|not (a )?real|we cancel|office cancel|weather|evaluator (sick|out)|merged|rebooked|moved to/i;
const NO_SHOW = /no[\s-]?show|nobody (was )?home|no one (was )?home|not home|wasn'?t home|didn'?t show|did not show|missed (the )?(visit|appointment)|stood (us )?up|no answer at (the )?door/i;
const CLIENT = /client|customer|homeowner|they cancel|cancell?ed by (the )?(client|customer|homeowner)|asked to cancel|called to cancel|changed (their|his|her) mind|can'?t make it|cannot make it|no longer (need|interested)|reschedul/i;
const GHL_CANCEL = /cancelled in gohighlevel/i;

/**
 * What kind of missed visit this was, or null for one we should not touch.
 *
 * GoHighLevel's own "cancelled" is counted as the client: the office cancels
 * in this app, which pushes to GHL, and a cancel that started there is the
 * client using the link in GHL's confirmation.
 */
export function classifyMissedVisit(reason: string | null | undefined): MissedVisitKind | null {
  const text = (reason ?? "").trim();
  if (!text) return null;
  if (OFFICE.test(text)) return null;
  if (NO_SHOW.test(text)) return "no_show";
  if (GHL_CANCEL.test(text)) return "client_cancelled";
  if (CLIENT.test(text)) return "client_cancelled";
  return null;
}

/** The reason the calendar pull writes for a GoHighLevel no-show. */
export const GHL_NO_SHOW_REASON = "No-show in GoHighLevel.";

const DAY = 24 * 60 * 60 * 1000;

/**
 * The rebook messages due now for one missed visit, as days after it. The
 * anchor is the later of the visit time and the moment it was marked, so a
 * visit cancelled a week ahead gets its first text the day it is cancelled,
 * not a week late, and a no-show marked that evening gets it that evening
 * (held for the morning by quiet hours if need be).
 */
export function rebookStepsDue(input: { anchor: Date; days: readonly number[]; now: Date; lateWindowHours?: number }): number[] {
  const late = (input.lateWindowHours ?? 24) * 60 * 60 * 1000;
  return input.days.filter((d) => {
    const behind = input.now.getTime() - (input.anchor.getTime() + d * DAY);
    return behind >= 0 && behind <= late;
  });
}

export function rebookDedupeKey(jobId: string, day: number, channel: "sms" | "email"): string {
  return `no_show_rebook:${jobId}:${day}:${channel}`;
}

const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";

export function rebookMessage(input: {
  kind: MissedVisitKind;
  day: number;
  channel: "sms" | "email";
  businessName: string;
  clientName: string | null;
  link: string;
  includeOptOut?: boolean;
  unsubscribeUrl?: string | null;
}): { subject: string; body: string } {
  const hi = firstName(input.clientName) ? `Hi ${firstName(input.clientName)}, ` : "";
  const line =
    input.day === 0
      ? input.kind === "no_show"
        ? `${hi}sorry we missed each other today. Pick a new time that suits you here:`
        : `${hi}no problem about the visit. When you're ready, pick a new time here:`
      : `${hi}still want that free evaluation? It takes two minutes to pick a time:`;
  if (input.channel === "sms") {
    const text = `${input.businessName}: ${line} ${input.link}`;
    return { subject: "", body: input.includeOptOut ? `${text} Reply STOP to stop.` : text };
  }
  const foot = [input.businessName, input.unsubscribeUrl ? `Not want these? ${input.unsubscribeUrl}` : null].filter((p): p is string => Boolean(p));
  return { subject: "Pick a new time for your evaluation", body: [line, input.link, "Or just reply to this email with a day that works.", ...foot].join("\n\n") };
}
