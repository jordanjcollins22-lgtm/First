/**
 * The reminders and follow-ups a client gets, and when.
 *
 * All of these are about work in hand: an appointment somebody booked, a
 * proposal they asked for, an invoice for work we did. None of them is
 * marketing, which is why they can go to a client who never ticked a box, and
 * why nothing in here will ever be pointed at a list.
 *
 * The rules are data rather than code so the office can turn one off, move it
 * a day, or switch it from a text to an email without a deploy. What is code
 * is the arithmetic: given a thing and a moment, is this one due, and has it
 * already gone.
 *
 * Nothing here sends. It decides.
 */

import type { Channel } from "@/lib/client-consent";

/** The things a reminder can be about. */
export type ReminderKind =
  | "evaluation_confirmed"
  | "evaluation_reminder"
  | "proposal_follow_up"
  | "job_start_reminder"
  | "invoice_reminder";

export interface ReminderRule {
  kind: ReminderKind;
  enabled: boolean;
  /** Which channels this goes out on. Both means both, if both are reachable. */
  channels: Channel[];
  /**
   * When it fires, in hours relative to the thing it is about.
   *
   * Negative is before: -18 on an appointment is the evening before a morning
   * visit. Positive is after: 72 on a proposal is three days later. A rule can
   * fire more than once, which is what a follow-up is.
   */
  offsetsHours: number[];
}

/**
 * What a business gets before anybody changes anything.
 *
 * Deliberately quiet. Two touches on a proposal and one on an appointment is
 * a business that is on top of things; five is a business somebody mutes.
 */
export const DEFAULT_RULES: ReminderRule[] = [
  { kind: "evaluation_confirmed", enabled: true, channels: ["sms", "email"], offsetsHours: [0] },
  { kind: "evaluation_reminder", enabled: true, channels: ["sms"], offsetsHours: [-18] },
  { kind: "proposal_follow_up", enabled: true, channels: ["email"], offsetsHours: [72, 168] },
  { kind: "job_start_reminder", enabled: true, channels: ["sms"], offsetsHours: [-18] },
  { kind: "invoice_reminder", enabled: true, channels: ["email"], offsetsHours: [168, 504] },
];

export const KIND_LABEL: Record<ReminderKind, string> = {
  evaluation_confirmed: "Evaluation booked",
  evaluation_reminder: "Evaluation coming up",
  proposal_follow_up: "Proposal not answered",
  job_start_reminder: "Job starting",
  invoice_reminder: "Invoice unpaid",
};

export const KIND_WHY: Record<ReminderKind, string> = {
  evaluation_confirmed: "Straight after somebody books, so they have it in writing.",
  evaluation_reminder: "Before we drive out to a house with nobody home.",
  proposal_follow_up: "A proposal nobody answered is not a no, it is a proposal nobody opened.",
  job_start_reminder: "So the gate is unlocked and the dog is in.",
  invoice_reminder: "Before it is old enough to be awkward.",
};

/** The thing a reminder is about: an appointment, a proposal, an invoice. */
export interface ReminderSubject {
  kind: ReminderKind;
  /** The row this is about, for the log and for not sending twice. */
  referenceId: string;
  customerId: string;
  /** The moment the rule counts from. */
  anchor: Date;
  /** True once the thing is done with: kept, answered, paid, cancelled. */
  settled: boolean;
}

/** One reminder that is due now, ready to be sent. */
export interface DueReminder {
  kind: ReminderKind;
  referenceId: string;
  customerId: string;
  channel: Channel;
  /** Hours from the anchor, so the wording can say "tomorrow" or "last week". */
  offsetHours: number;
  /**
   * What makes this send unique.
   *
   * Every reminder is written down under this before it goes, and a key that
   * is already in the log is a reminder that already went. It is what makes a
   * cron safe to run twice, run late, or run twice at once, which it will.
   */
  dedupeKey: string;
}

export function dedupeKeyFor(
  kind: ReminderKind,
  referenceId: string,
  offsetHours: number,
  channel: Channel
): string {
  return `${kind}:${referenceId}:${offsetHours}:${channel}`;
}

const HOUR = 60 * 60 * 1000;

/**
 * The reminders that are due for one thing, right now.
 *
 * "Due" means the moment has passed and not by so much that sending it now
 * would be strange. A reminder for an appointment that happened yesterday is
 * not a reminder, it is a confusing text, so anything more than a window late
 * is silently let go: the cron may have been down, and catching up is worse
 * than missing it.
 *
 * The exception is the confirmation, which is welcome whenever it arrives.
 */
export function dueFor(
  subject: ReminderSubject,
  rules: readonly ReminderRule[],
  now: Date,
  lateWindowHours = 24
): DueReminder[] {
  if (subject.settled) return [];
  const rule = rules.find((r) => r.kind === subject.kind);
  if (!rule || !rule.enabled || rule.channels.length === 0) return [];

  const due: DueReminder[] = [];
  for (const offsetHours of rule.offsetsHours) {
    const fireAt = subject.anchor.getTime() + offsetHours * HOUR;
    const late = now.getTime() - fireAt;
    if (late < 0) continue;
    if (subject.kind !== "evaluation_confirmed" && late > lateWindowHours * HOUR) continue;

    for (const channel of rule.channels) {
      due.push({
        kind: subject.kind,
        referenceId: subject.referenceId,
        customerId: subject.customerId,
        channel,
        offsetHours,
        dedupeKey: dedupeKeyFor(subject.kind, subject.referenceId, offsetHours, channel),
      });
    }
  }
  return due;
}

/**
 * The whole list, with everything already sent taken out.
 *
 * The log is the memory. Nothing here looks at whether a message arrived,
 * only at whether we tried, because trying twice is the failure mode that
 * costs a client's patience and a phone number's reputation.
 */
export function dueNow(
  subjects: readonly ReminderSubject[],
  rules: readonly ReminderRule[],
  alreadySent: ReadonlySet<string>,
  now: Date,
  lateWindowHours = 24
): DueReminder[] {
  return subjects
    .flatMap((subject) => dueFor(subject, rules, now, lateWindowHours))
    .filter((reminder) => !alreadySent.has(reminder.dedupeKey));
}

/**
 * Rules as stored, merged onto the defaults.
 *
 * A business that has never touched the settings has no rows, and should get
 * the defaults rather than silence. A kind added to the app later is the same
 * situation: it arrives switched to whatever the default says.
 */
export function mergeRules(stored: readonly Partial<ReminderRule>[]): ReminderRule[] {
  return DEFAULT_RULES.map((fallback) => {
    const saved = stored.find((rule) => rule.kind === fallback.kind);
    if (!saved) return { ...fallback };
    return {
      kind: fallback.kind,
      enabled: saved.enabled ?? fallback.enabled,
      channels: saved.channels?.length ? saved.channels : fallback.channels,
      offsetsHours: saved.offsetsHours?.length ? saved.offsetsHours : fallback.offsetsHours,
    };
  });
}

/** How a rule's timing reads on a settings screen. */
export function describeOffset(hours: number): string {
  if (hours === 0) return "straight away";
  const before = hours < 0;
  const size = Math.abs(hours);
  const amount =
    size % 24 === 0 ? `${size / 24} day${size === 24 ? "" : "s"}` : `${size} hour${size === 1 ? "" : "s"}`;
  return before ? `${amount} before` : `${amount} after`;
}
