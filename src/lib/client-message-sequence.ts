/**
 * Every automated message a client gets, in the order they get them, for
 * the owner to read the way the client will.
 *
 * Built from the same wording and the same rules the senders use: the
 * evaluation emails as this business has them written, the reminder rules
 * as they are set, and the proposal and before-and-after emails the account
 * manager sends. Pure: it composes, it never sends.
 */

import { renderTemplate, type SequenceStep } from "@/lib/evaluation-sequence";
import { composeReminder, fitSms } from "@/lib/client-message-templates";
import { describeOffset, KIND_LABEL, type ReminderKind, type ReminderRule } from "@/lib/client-reminders";
import { proposalReadyEmail } from "@/lib/proposal-ready-email";
import { beforeAfterEmail } from "@/lib/project-closeout";

export interface SequenceMessage {
  key: string;
  /** Where in the client's journey it lands. */
  stage: "evaluation" | "proposal" | "job" | "invoice";
  title: string;
  /** When it goes, in the office's words. */
  when: string;
  channel: "email" | "sms";
  /** Switched on, so it actually goes. */
  on: boolean;
  /** Sent by a person pressing a button, rather than on a timer. */
  byHand: boolean;
  /** Parked on My Day for the owner's OK before it goes. */
  heldForOk: boolean;
  subject: string;
  body: string;
  /** Anything the owner should know that the switch doesn't say. */
  note: string | null;
}

export interface SequenceInput {
  businessName: string;
  steps: readonly SequenceStep[];
  rules: readonly ReminderRule[];
  /** Reminders switched on for the business at all. */
  remindersOn: boolean;
  /** Emails wait for the owner's OK. */
  approvalRequired: boolean;
  /** The filling for the evaluation emails' braces. */
  vars: Record<string, string>;
  sample: { clientName: string; address: string; evaluator: string; manager: string; baseUrl: string };
}

/** What each reminder counts from, for saying when it goes. */
const ANCHOR: Record<ReminderKind, { thing: string; zero: string }> = {
  evaluation_confirmed: { thing: "they book", zero: "Right after they book" },
  evaluation_reminder: { thing: "the visit", zero: "At the time of the visit" },
  proposal_follow_up: { thing: "the proposal is sent, if they haven't answered", zero: "When the proposal is sent" },
  job_start_reminder: { thing: "the job starts", zero: "When the job starts" },
  invoice_reminder: { thing: "the invoice goes, if it's unpaid", zero: "When the invoice goes" },
};

const STAGE_OF: Record<ReminderKind, SequenceMessage["stage"]> = {
  evaluation_confirmed: "evaluation",
  evaluation_reminder: "evaluation",
  proposal_follow_up: "proposal",
  job_start_reminder: "job",
  invoice_reminder: "invoice",
};

function sayWhen(kind: ReminderKind, hours: number): string {
  if (hours === 0) return ANCHOR[kind].zero;
  if (hours === -18 && (kind === "evaluation_reminder" || kind === "job_start_reminder")) {
    return `The evening before ${kind === "job_start_reminder" ? "the job" : "the visit"}`;
  }
  // describeOffset already says "3 days after" or "18 hours before".
  const text = `${describeOffset(hours)} ${ANCHOR[kind].thing}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Every message, in order: the evaluation, the proposal, the job, the invoice. */
export function buildMessageSequence(input: SequenceInput): SequenceMessage[] {
  const { sample, businessName } = input;
  const facts = (kind: ReminderKind) => ({
    businessName,
    clientName: sample.clientName,
    address: sample.address,
    when: kind === "job_start_reminder" ? "tomorrow" : kind.startsWith("evaluation") ? "Thursday at 9am" : null,
    // Only the proposal follow-up carries a link, as the sender builds it.
    link: kind === "proposal_follow_up" ? `${sample.baseUrl}/proposal/sample` : null,
    amount: kind === "invoice_reminder" ? "$1,850" : null,
  });

  const out: SequenceMessage[] = [];

  // The evaluation emails, in their own order.
  for (const step of [...input.steps].sort((a, b) => a.ordinal - b.ordinal)) {
    out.push({
      key: `evaluation-${step.step}`,
      stage: "evaluation",
      title: step.label,
      when: step.timing,
      channel: "email",
      on: step.enabled,
      byHand: false,
      heldForOk: input.approvalRequired,
      subject: renderTemplate(step.subject, input.vars),
      body: renderTemplate(step.body, input.vars),
      note: null,
    });
  }

  // The reminder rules: every offset, on every channel it can go on. A
  // channel the rule is not set to is still shown, switched off, so the
  // text versions can be read before anybody turns them on.
  const reminder = (kind: ReminderKind) => {
    const rule = input.rules.find((r) => r.kind === kind);
    if (!rule) return;
    for (const hours of rule.offsetsHours) {
      for (const channel of ["email", "sms"] as const) {
        const composed = composeReminder(kind, channel, facts(kind), {
          includeOptOut: channel === "sms",
          unsubscribeUrl: `${sample.baseUrl}/u/sample`,
        });
        const switchedOn = input.remindersOn && rule.enabled && rule.channels.includes(channel);
        // The reminder run gathers appointments, proposals and job starts;
        // nothing in it looks at invoices yet, so this rule sends nothing.
        const unsent = kind === "invoice_reminder";
        out.push({
          key: `${kind}-${hours}-${channel}`,
          stage: STAGE_OF[kind],
          title: `${KIND_LABEL[kind]}${channel === "sms" ? " (text)" : ""}`,
          when: sayWhen(kind, hours),
          channel,
          on: switchedOn && !unsent,
          note: unsent && switchedOn ? "Switched on, but nothing sends invoice reminders yet." : null,
          byHand: false,
          heldForOk: channel === "email" && input.approvalRequired,
          subject: composed.subject,
          body: channel === "sms" ? fitSms(composed.body) : composed.body,
        });
      }
    }
  };

  reminder("evaluation_confirmed");
  reminder("evaluation_reminder");

  const proposal = proposalReadyEmail({
    clientName: sample.clientName,
    address: sample.address,
    validDays: 30,
    link: `${sample.baseUrl}/proposal/sample`,
    businessName,
    signedBy: sample.manager,
  });
  out.push({
    key: "proposal-ready",
    stage: "proposal",
    title: "The proposal",
    when: "When the account manager presses Send to client",
    channel: "email",
    on: true,
    byHand: true,
    // The first words a client reads about the price are always read first.
    heldForOk: true,
    subject: proposal.subject,
    body: proposal.text,
    note: null,
  });
  reminder("proposal_follow_up");
  reminder("job_start_reminder");

  const done = beforeAfterEmail({ clientName: sample.clientName, businessName, link: `${sample.baseUrl}/done/sample`, signedBy: sample.manager });
  out.push({
    key: "before-after",
    stage: "job",
    title: "The before and after",
    when: "When the account manager sends the before and afters, after the walkthrough",
    channel: "email",
    on: true,
    byHand: true,
    heldForOk: false,
    subject: done.subject,
    body: done.text,
    note: null,
  });
  reminder("invoice_reminder");

  return out;
}
