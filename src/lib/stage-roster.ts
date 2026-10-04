/**
 * Who is at a step of The system right now, and where each of them is in
 * that step's emails and texts: the last one they got, the next one due and
 * when, or the step they move on to once the messages here are done.
 *
 * Read off what is already recorded: each sent message's dedupe key names
 * the message, and the job's own dates say when the rest are due. Pure, so
 * the timing is tested.
 */

import type { SequenceMessage } from "@/lib/client-message-sequence";

/** The dates every message's timing counts from. */
export interface RosterAnchors {
  bookedAt?: string | null;
  visitAt?: string | null;
  proposalSentAt?: string | null;
  jobStartAt?: string | null;
}

export interface RosterPersonInput {
  jobId: string;
  client: string;
  anchors: RosterAnchors;
  /** Messages already sent to them, by sequence key, with when. */
  sent: Map<string, string>;
}

export interface RosterRow {
  jobId: string;
  client: string;
  /** The last message here they got. Null when none yet. */
  had: { number: string; label: string; at: string } | null;
  /** The next message here due for them. Null when they have had them all. */
  next: { number: string; label: string; at: string | null; byHand: boolean } | null;
}

/** Hours from booking, before or after the visit, and so on, for the evaluation emails. */
const EVALUATION_STEP_HOURS: Record<string, number> = { two_days: -48, day_before: -15, morning_of: -1, after: 3 };

/** The sequence key a sent message's dedupe key stands for, or null when it is not one of the sequence's. */
export function sequenceKeyFromDedupe(dedupe: string): string | null {
  const parts = dedupe.split(":");
  if (parts[0] === "evaluation_sequence" && parts.length >= 3) return `evaluation-${parts[2]}`;
  if (parts[0] === "proposal_ready") return "proposal-ready";
  if (["evaluation_confirmed", "evaluation_reminder", "proposal_follow_up", "job_start_reminder", "invoice_reminder"].includes(parts[0]) && parts.length >= 4) {
    return `${parts[0]}-${parts[2]}-${parts[3]}`;
  }
  return null;
}

/** When a message is due for somebody, from their dates. Null when it is sent by hand or the date it counts from is not set. */
export function dueAt(key: string, anchors: RosterAnchors): string | null {
  const plus = (iso: string | null | undefined, hours: number) => (iso ? new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString() : null);
  if (key === "evaluation-booked") return anchors.bookedAt ?? null;
  const evaluationStep = key.match(/^evaluation-([a-z_]+)$/);
  if (evaluationStep) return plus(anchors.visitAt, EVALUATION_STEP_HOURS[evaluationStep[1]] ?? 0);
  const reminder = key.match(/^([a-z_]+)-(-?\d+)-(sms|email)$/);
  if (reminder) {
    const [, kind, hours] = reminder;
    const h = Number(hours);
    if (kind === "evaluation_confirmed") return plus(anchors.bookedAt, h);
    if (kind === "evaluation_reminder") return plus(anchors.visitAt, h);
    if (kind === "proposal_follow_up") return plus(anchors.proposalSentAt, h);
    if (kind === "job_start_reminder") return plus(anchors.jobStartAt, h);
  }
  if (key === "proposal-ready") return anchors.proposalSentAt ?? null;
  return null;
}

/** Each person's place among this step's messages, those with something next first. */
export function stageRoster(messages: SequenceMessage[], people: RosterPersonInput[], now: Date = new Date()): RosterRow[] {
  const label = (m: SequenceMessage) => `${m.channel === "sms" ? "Text" : "Email"} · ${m.moment}`;
  return people
    .map((person) => {
      let had: RosterRow["had"] = null;
      for (const m of messages) {
        const at = person.sent.get(m.key);
        if (at && (!had || at >= had.at)) had = { number: m.number, label: label(m), at };
      }
      // Next: the first message switched on, not yet sent, in sequence order, that is still to come.
      const upcoming = messages
        .filter((m) => m.on && !person.sent.has(m.key))
        .map((m) => ({ m, at: dueAt(m.key, person.anchors) }))
        .filter(({ m, at }) => m.byHand || (at != null && at >= now.toISOString()));
      const first = upcoming[0];
      return {
        jobId: person.jobId,
        client: person.client,
        had,
        next: first ? { number: first.m.number, label: label(first.m), at: first.at, byHand: first.m.byHand } : null,
      };
    })
    .sort((a, b) => (a.next?.at ?? "9").localeCompare(b.next?.at ?? "9"));
}
