/**
 * Phone calls through the business's Twilio number: which ones were missed,
 * the text a missed caller gets, and what an outbound call's result means
 * for the proposal call log.
 *
 * Twilio reports the outcome of a <Dial> to its action URL as DialCallStatus:
 * completed (somebody answered), no-answer, busy, failed or canceled (the
 * caller hung up while it rang). Pure.
 */

import type { CallOutcome } from "@/lib/call-list";

/** Last ten digits, the way the rest of the app matches phone numbers (lib/sms.ts). */
export const last10 = (phone: string) => phone.replace(/\D/g, "").slice(-10);

export type DialStatus = "completed" | "answered" | "no-answer" | "busy" | "failed" | "canceled";

/** Whether a call nobody on our side picked up. */
export function isMissedDial(status: string | null | undefined): boolean {
  const s = (status ?? "").toLowerCase();
  if (s === "completed" || s === "answered") return false;
  return s === "no-answer" || s === "busy" || s === "failed" || s === "canceled" || s === "";
}

/** Whether an answered call was long enough to have been a conversation. */
export function wasConversation(status: string | null | undefined, durationSeconds: number): boolean {
  const s = (status ?? "").toLowerCase();
  return (s === "completed" || s === "answered") && durationSeconds >= 20;
}

/** The text-back key: one per number per business day, however often they ring. */
export function missedCallKey(fromNumber: string, day: string): string {
  return `missed_call_text:${last10(fromNumber)}:${day}`;
}

/** Numbers we never text back: blocked, withheld, short codes, nonsense. */
export function textableCaller(fromNumber: string | null | undefined): boolean {
  const digits = (fromNumber ?? "").replace(/\D/g, "");
  if (digits.length < 10) return false;
  const ten = digits.slice(-10);
  // NANP: area code and exchange cannot start with 0 or 1; 555-01xx is fiction.
  if (/^[01]/.test(ten) || /^\d{3}[01]/.test(ten)) return false;
  if (digits.length > 11) return false;
  return true;
}

/** The text a missed caller gets. Short: it is a text, and they just rang. */
export function missedCallText(input: { businessName: string; bookLink: string; includeOptOut: boolean }): string {
  const text = `${input.businessName}: Sorry we missed you! Book a free visit here ${input.bookLink} or just reply to this text and we'll get right back to you.`;
  return input.includeOptOut ? `${text} Reply STOP to stop.` : text;
}

/**
 * What a click-to-call to a client means for the proposal call log, without
 * anybody tapping anything. An answered call needs a person to say what the
 * client said, so it waits for a disposition; one that never connected is a
 * "no answer", which is exactly what the account manager would have tapped.
 */
export function automaticOutcome(direction: "inbound" | "outbound", status: string, durationSeconds: number): CallOutcome | "needs_disposition" | null {
  if (direction === "outbound") {
    // A few seconds "answered" is a voicemail greeting or a hang-up, which
    // the account manager would also have called no answer.
    return wasConversation(status, durationSeconds) ? "needs_disposition" : "no_answer";
  }
  return wasConversation(status, durationSeconds) ? "needs_disposition" : null;
}
