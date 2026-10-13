/**
 * Proposal follow-ups, five touches long, that stop the moment the client
 * says anything.
 *
 * Landscapers typically stop after two or three touches when five to seven is
 * the norm. So a sent proposal now gets days 3, 7, 14, 21 and 30, email and
 * text in turn, and the sequence ends on any of: accept, decline, expiry, or
 * a reply on any channel we can see (a text, an email, a GoHighLevel reply, a
 * message on the proposal page, a call). Jobber stops on status only; stopping
 * on a reply is the part that keeps this from being a nag.
 *
 * Pure. The client-reminders run asks it what is due.
 */

import type { Channel } from "@/lib/client-consent";

const HOUR = 60 * 60 * 1000;

/**
 * Which channel each touch goes on, by position: email first (it carries the
 * proposal properly), then a short text, and so on. A touch whose channel the
 * client cannot be reached on is simply not sent; the next one may be.
 */
export function followUpChannel(index: number): Channel {
  return index % 2 === 0 ? "email" : "sms";
}

/** The touches, as hours after sending, each with its channel. */
export function followUpPlan(days: readonly number[]): { offsetHours: number; channel: Channel }[] {
  return [...days]
    .sort((a, b) => a - b)
    .map((d, index) => ({ offsetHours: Math.round(d * 24), channel: followUpChannel(index) }));
}

/**
 * The original two touches, which every business has had since before this
 * sequence existed. Proposals sent before the five-touch switch went on keep
 * exactly these, on the rule's own channels, so turning the switch on never
 * reaches back to a proposal from three weeks ago with a day-21 text.
 */
export const LEGACY_OFFSETS_HOURS = [72, 168];

export interface FollowUpFacts {
  status: string;
  sentAt: Date;
  expiresAt: Date | null;
  /** The latest thing the client said to us on any channel, if any. */
  lastClientContactAt: Date | null;
}

export type FollowUpStop = "answered" | "expired" | "replied" | null;

/** Why the sequence is over for this proposal, or null while it still runs. */
export function followUpStop(facts: FollowUpFacts, now: Date): FollowUpStop {
  if (facts.status !== "sent") return "answered";
  if (facts.expiresAt && facts.expiresAt.getTime() <= now.getTime()) return "expired";
  if (facts.lastClientContactAt && facts.lastClientContactAt.getTime() > facts.sentAt.getTime()) return "replied";
  return null;
}

/**
 * The touches due right now for one proposal: their moment has passed, by no
 * more than the late window, and the sequence has not stopped. The caller
 * removes the ones already in the log.
 */
export function followUpsDue(input: {
  facts: FollowUpFacts;
  plan: { offsetHours: number; channel: Channel }[];
  now: Date;
  lateWindowHours?: number;
}): { offsetHours: number; channel: Channel }[] {
  if (followUpStop(input.facts, input.now)) return [];
  const late = (input.lateWindowHours ?? 24) * HOUR;
  return input.plan.filter((touch) => {
    const fireAt = input.facts.sentAt.getTime() + touch.offsetHours * HOUR;
    const behind = input.now.getTime() - fireAt;
    return behind >= 0 && behind <= late;
  });
}

const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";

/**
 * The words for touch n. Each one says something new rather than "just
 * following up" five times: questions, then changes, then timing, then a
 * graceful last note that makes replying easy.
 */
export function followUpMessage(input: {
  index: number;
  channel: Channel;
  businessName: string;
  clientName: string | null;
  address: string | null;
  link: string;
  includeOptOut?: boolean;
  unsubscribeUrl?: string | null;
  howToReply?: string;
}): { subject: string; body: string } {
  const hi = firstName(input.clientName) ? `Hi ${firstName(input.clientName)}, ` : "";
  const place = input.address ? ` for ${input.address}` : "";
  const lines: { subject: string; line: string }[] = [
    { subject: "Any questions about your proposal?", line: `${hi}we sent your proposal${place} and have not heard back yet. Any questions, just reply.` },
    { subject: "Your proposal", line: `${hi}checking you got your proposal${place}. Happy to walk through it on the phone if that's easier.` },
    { subject: "Would a smaller first step help?", line: `${hi}if the whole proposal${place} is more than you want to take on right now, we can start with the part that matters most and do the rest later. Reply and tell us what to change.` },
    { subject: "Holding your spot on the schedule", line: `${hi}our schedule is filling up. If you'd like the work${place} done this season, accepting soon keeps your place in line.` },
    { subject: "Should we close your proposal?", line: `${hi}we haven't heard back about your proposal${place}, so we'll stop reminding you. If you'd still like it, the link works until it expires, or reply any time.` },
  ];
  const pick = lines[Math.min(input.index, lines.length - 1)];

  if (input.channel === "sms") {
    const text = `${input.businessName}: ${pick.line} ${input.link}`;
    return { subject: "", body: input.includeOptOut ? `${text} Reply STOP to stop.` : text };
  }
  const foot = [input.howToReply, input.businessName, input.unsubscribeUrl ? `Not want these reminders? ${input.unsubscribeUrl}` : null].filter(
    (part): part is string => Boolean(part)
  );
  return { subject: pick.subject, body: [pick.line, input.link, ...foot].join("\n\n") };
}
