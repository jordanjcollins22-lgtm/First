import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeScheduledCall } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { outboundBaseUrl } from "@/lib/base-url";
import { ensureSendingReady } from "@/lib/email/ready";
import { bookedSequenceKey } from "@/lib/data/evaluation-sequence-send";
import { expireStaleApprovals, notifyApprovers } from "@/lib/data/outbound-approvals";
import {
  dedupeKeyFor,
  dueNow,
  mergeRules,
  type DueReminder,
  type ReminderKind,
  type ReminderRule,
  type ReminderSubject,
} from "@/lib/client-reminders";
import { composeReminder, fitSms, sayWhen } from "@/lib/client-message-templates";
import { BUSINESS_TIME_ZONE, zonedToUtc } from "@/lib/time-zone";
import { HOW_TO_REPLY } from "@/lib/message-via";
import {
  alreadySent,
  contactsFor,
  quietWindowFor,
  sendClientMessage,
} from "@/lib/data/client-messaging";
import { lastClientContact, loadSequenceSettings } from "@/lib/data/client-automations";
import { isLiveFor, type SequenceKey, type SequenceSetting } from "@/lib/client-automations/settings";
import {
  invoiceDueAt,
  invoiceReminderMessage,
  invoiceSettled,
  invoiceTakesReminders,
} from "@/lib/client-automations/invoices";
import {
  followUpMessage,
  followUpPlan,
  followUpsDue,
  LEGACY_OFFSETS_HOURS,
} from "@/lib/client-automations/proposal-follow-ups";

/**
 * The automated reminders and follow-ups clients get.
 *
 * Everything this sends is about work in hand: an appointment somebody
 * booked, a proposal they asked for, an invoice for work we did. It never
 * touches a list, and it cannot: it starts from the appointments, proposals
 * and invoices themselves, so a contact with nothing going on is not a
 * candidate however they got into the database.
 *
 * Safe to run twice, run late, or run twice at once. Every send is claimed
 * under a unique key before it goes out, and a claim that fails is a message
 * somebody else already sent.
 *
 * Off until a business turns it on. A cron that texts people ships switched
 * off, and this one checks that switch per business on every run.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How late is too late to send a reminder about something. */
const LATE_WINDOW_HOURS = 24;

export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  }
  const refused = await authorizeScheduledCall(request, "client-reminders");
  if (refused) return refused;

  const admin = createAdminClient();
  const now = new Date();

  const { data: orgs } = await admin
    .from("organizations")
    .select("id, name, client_reminders_enabled, reminder_time_zone, reminder_quiet_start, reminder_quiet_end")
    .eq("client_reminders_enabled", true);

  if (!orgs || orgs.length === 0) {
    return NextResponse.json({ sent: 0, note: "No business has client reminders switched on." });
  }

  // The business's own domain, not whichever deployment address the timer
  // happened to call. Built from the request, this put a
  // first-xxxx.vercel.app link into every client's reminder.
  const origin = (await outboundBaseUrl()) || new URL(request.url).origin;
  let sent = 0;
  let skipped = 0;
  let held = 0;
  let awaiting = 0;

  await expireStaleApprovals(admin, now).catch(() => 0);

  for (const org of orgs) {
    // The sending domain, checked once a day whether or not anything is due.
    // A domain whose DNS landed on Monday should not wait for the first
    // reminder to find out it is verified.
    await ensureSendingReady(org.id, "transactional").catch(() => false);

    const { data: storedRules } = await admin
      .from("reminder_rules")
      .select("kind, enabled, channels, offsets_hours")
      .eq("organization_id", org.id);

    const rules: ReminderRule[] = mergeRules(
      (storedRules ?? []).map((row) => ({
        kind: row.kind as ReminderKind,
        enabled: row.enabled,
        channels: (row.channels ?? []) as ReminderRule["channels"],
        offsetsHours: row.offsets_hours ?? [],
      }))
    );

    const sequences = await loadSequenceSettings(admin, org.id);
    const { subjects, proposals } = await subjectsFor(admin, org.id, now, sequences);
    if (subjects.length === 0 && proposals.length === 0) continue;

    // Everything the rules say is due, then everything of that we have
    // already sent taken out of it. Two steps rather than one query per
    // reminder: a run reminding forty people is a handful of queries.
    const candidates = [
      ...dueNow(subjects.map((s) => s.subject), rules, new Set(), now, LATE_WINDOW_HOURS),
      ...(await proposalFollowUpsDue(admin, proposals, rules, sequences.proposal_follow_ups, now)),
    ];
    if (candidates.length === 0) continue;
    // The evaluation email sequence sends its own "you are booked". A
    // confirmation on top of that is the same email twice, a day apart.
    const aliasOf = (c: { kind: string; referenceId: string; channel: string }) =>
      c.kind === "evaluation_confirmed" ? bookedSequenceKey(c.referenceId, c.channel) : null;
    const done = await alreadySent(
      org.id,
      candidates.flatMap((c) => [c.dedupeKey, aliasOf(c)].filter((k): k is string => k != null))
    );
    const due = candidates.filter((c) => {
      const alias = aliasOf(c);
      return !done.has(c.dedupeKey) && !(alias && done.has(alias));
    });
    if (due.length === 0) continue;

    const contacts = await contactsFor(due.map((d) => d.customerId));
    const window = quietWindowFor(org);
    let parked = 0;
    const byReference = new Map(subjects.map((s) => [`${s.subject.kind}:${s.subject.referenceId}`, s]));
    for (const p of proposals) byReference.set(`proposal_follow_up:${p.id}`, p.facts);

    for (const reminder of due) {
      const contact = contacts.get(reminder.customerId);
      const facts = byReference.get(`${reminder.kind}:${reminder.referenceId}`);
      if (!contact || !facts) continue;

      // Required on the first text to a number, and tiresome after that.
      const includeOptOut = reminder.channel === "sms" && !contact.textedBefore;
      const unsubscribeUrl = contact.unsubscribeToken ? `${origin}/u/${contact.unsubscribeToken}` : null;
      // A Stripe pay link is already absolute; the app's own links are not.
      const link = facts.link ? (/^https?:\/\//.test(facts.link) ? facts.link : `${origin}${facts.link}`) : null;

      let message: { subject: string; body: string };
      if (reminder.kind === "invoice_reminder" && facts.when) {
        message = invoiceReminderMessage({
          offsetHours: reminder.offsetHours,
          channel: reminder.channel,
          businessName: org.name,
          clientName: contact.name,
          amount: Number(facts.amount ?? 0),
          dueAt: facts.when,
          timeZone: window.timeZone,
          payLink: link,
          includeOptOut,
          unsubscribeUrl,
          howToReply: HOW_TO_REPLY,
        });
      } else if (reminder.kind === "proposal_follow_up" && link && facts.touchIndex) {
        message = followUpMessage({
          index: facts.touchIndex.get(reminder.offsetHours) ?? 0,
          channel: reminder.channel,
          businessName: org.name,
          clientName: contact.name,
          address: facts.address,
          link,
          includeOptOut,
          unsubscribeUrl,
          howToReply: HOW_TO_REPLY,
        });
      } else {
        message = composeReminder(
          reminder.kind,
          reminder.channel,
          {
            businessName: org.name,
            clientName: contact.name,
            when: facts.when ? sayWhen(facts.when, window.timeZone, now, { dayOnly: facts.dayOnly }) : null,
            address: facts.address,
            link,
            amount: facts.amount,
          },
          { includeOptOut, unsubscribeUrl }
        );
      }

      const outcome = await sendClientMessage(
        {
          organizationId: org.id,
          customerId: reminder.customerId,
          channel: reminder.channel,
          // Every one of these is about work in hand. Nothing here is
          // marketing, and nothing here may be pointed at a list.
          basis: "service",
          kind: reminder.kind,
          referenceId: reminder.referenceId,
          dedupeKey: reminder.dedupeKey,
          subject: message.subject,
          body: reminder.channel === "sms" ? fitSms(message.body) : message.body,
          automatic: true,
        },
        contact,
        window,
        now
      );

      if (outcome.sent) sent += 1;
      else if (outcome.reason === "quiet_hours") held += 1;
      else if (outcome.reason === "awaiting_approval") {
        awaiting += 1;
        parked += 1;
      } else skipped += 1;
    }

    // One note per business per run, not one per email.
    if (parked > 0) {
      await notifyApprovers(admin, org.id).catch((err) => {
        log.warn("approvals.notify_failed", { organizationId: org.id, error: err instanceof Error ? err.message : String(err) });
      });
    }
  }

  log.info("cron.client_reminders", { sent, skipped, held, awaiting, orgs: orgs.length });
  return NextResponse.json({ sent, skipped, held, awaiting });
}

/** One thing a reminder could be about, with what the wording needs. */
interface SubjectWithFacts {
  subject: ReminderSubject;
  when: Date | null;
  /** A day with no time on it: a work day, not an appointment. */
  dayOnly?: boolean;
  address: string | null;
  link: string | null;
  amount: string | null;
  /** Proposal follow-ups: which touch each offset is, for its wording. */
  touchIndex?: Map<number, number>;
}

/** A sent proposal the follow-up sequence may still be working. */
interface ProposalInPlay {
  id: string;
  customerId: string;
  status: string;
  sentAt: Date;
  expiresAt: Date | null;
  facts: SubjectWithFacts;
}

/**
 * The proposal follow-ups due now.
 *
 * Proposals sent since "Proposal follow-ups (5 touches)" was switched on get
 * the five-touch plan, email and text in turn. Everything else keeps the
 * original two touches on the rule's own channels, so switching the plan on
 * never reaches back to a proposal from three weeks ago. Either way the
 * sequence stops on accept, decline, expiry, or a reply on any channel. The
 * rule's own switch still turns all of it off.
 */
async function proposalFollowUpsDue(
  admin: ReturnType<typeof createAdminClient>,
  proposals: ProposalInPlay[],
  rules: ReminderRule[],
  setting: SequenceSetting,
  now: Date
): Promise<DueReminder[]> {
  const rule = rules.find((r) => r.kind === "proposal_follow_up");
  if (!rule?.enabled || proposals.length === 0) return [];
  const replied = await lastClientContact(admin, proposals.map((p) => p.customerId));
  const extended = followUpPlan(setting.config.followUpDays);
  const legacy = LEGACY_OFFSETS_HOURS.flatMap((offsetHours) => rule.channels.map((channel) => ({ offsetHours, channel })));

  const out: DueReminder[] = [];
  for (const p of proposals) {
    const plan = isLiveFor(setting, p.sentAt) ? extended : legacy;
    p.facts.touchIndex = new Map([...new Set(plan.map((t) => t.offsetHours))].sort((a, b) => a - b).map((h, i) => [h, i]));
    const due = followUpsDue({
      facts: { status: p.status, sentAt: p.sentAt, expiresAt: p.expiresAt, lastClientContactAt: replied.get(p.customerId) ?? null },
      plan,
      now,
      lateWindowHours: LATE_WINDOW_HOURS,
    });
    for (const touch of due) {
      out.push({
        kind: "proposal_follow_up",
        referenceId: p.id,
        customerId: p.customerId,
        channel: touch.channel,
        offsetHours: touch.offsetHours,
        // The same key the two-touch sequence always used, so the day-3 email
        // is one message whichever plan a proposal is on.
        dedupeKey: dedupeKeyFor("proposal_follow_up", p.id, touch.offsetHours, touch.channel),
      });
    }
  }
  return out;
}

/**
 * Everything a business might owe a client a message about.
 *
 * Read from the work itself rather than from a list of people: appointments,
 * proposals, invoices. A contact with none of those is not here, which is the
 * structural reason this can never become a marketing send.
 */
async function subjectsFor(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  now: Date,
  sequences: Record<SequenceKey, SequenceSetting>
): Promise<{ subjects: SubjectWithFacts[]; proposals: ProposalInPlay[] }> {
  const out: SubjectWithFacts[] = [];
  const inPlay: ProposalInPlay[] = [];
  const recently = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();

  // Filtered on the join rather than by a list of ids. This used to read
  // every customer in the business and put all their ids in the next
  // request's URL, and at a couple of thousand customers that request is
  // refused, quietly, and the run reminds nobody.
  const { data: jobs, error: jobsError } = await admin
    .from("jobs")
    .select(
      "id, evaluation_date, evaluation_status, project_start_date, completed_at, created_at, property:properties!inner(address, customer_id, customer:customers!inner(organization_id))"
    )
    .eq("property.customer.organization_id", organizationId)
    .is("cancelled_at", null)
    .or("evaluation_date.not.is.null,project_start_date.not.is.null")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (jobsError) {
    log.error("cron.client_reminders.jobs", jobsError, { organizationId });
    return { subjects: out, proposals: inPlay };
  }

  type JobRow = {
    id: string;
    evaluation_date: string | null;
    evaluation_status: string | null;
    project_start_date: string | null;
    completed_at: string | null;
    created_at: string;
    property: { address: string; customer_id: string | null } | null;
  };
  const rows = (jobs ?? []) as unknown as JobRow[];

  for (const job of rows) {
    const property = job.property;
    if (!property?.customer_id) continue;

    if (job.evaluation_date) {
      const visit = new Date(job.evaluation_date);
      const cancelled = job.evaluation_status === "cancelled";

      // The confirmation counts from the booking, not the visit, and there
      // is nothing to confirm once the visit has happened. Counting it from
      // the visit was how every evaluation ever done became due for a
      // "you're booked" email the day the rule was switched on.
      const booked = new Date(job.created_at);
      out.push({
        subject: {
          kind: "evaluation_confirmed",
          referenceId: job.id,
          customerId: property.customer_id,
          anchor: booked < visit ? booked : visit,
          settled: cancelled || visit.getTime() <= now.getTime(),
        },
        when: visit,
        address: property.address,
        link: null,
        amount: null,
      });

      out.push({
        subject: {
          kind: "evaluation_reminder",
          referenceId: job.id,
          customerId: property.customer_id,
          anchor: visit,
          settled: cancelled,
        },
        when: visit,
        address: property.address,
        link: null,
        amount: null,
      });
    }

    if (job.project_start_date) {
      // The work day's morning, on the business's clock. Read as a bare date
      // it was midnight UTC, which is eight the evening before here: the
      // reminder fired a day early and said "today at 8pm".
      const anchor = zonedToUtc(job.project_start_date.slice(0, 10), "08:00", BUSINESS_TIME_ZONE);
      out.push({
        subject: {
          kind: "job_start_reminder",
          referenceId: job.id,
          customerId: property.customer_id,
          anchor,
          settled: Boolean(job.completed_at),
        },
        when: anchor,
        dayOnly: true,
        address: property.address,
        link: null,
        amount: null,
      });
    }
  }

  // Proposals carry the business directly, so no list of job ids is needed.
  const { data: proposals, error: proposalsError } = await admin
    .from("job_proposals")
    .select("id, token, status, created_at, sent_at, expires_at, job:jobs!inner(id, cancelled_at, property:properties!inner(address, customer_id))")
    .eq("organization_id", organizationId)
    .eq("status", "sent")
    .not("sent_at", "is", null)
    .gte("created_at", recently)
    .limit(500);
  if (proposalsError) {
    log.error("cron.client_reminders.proposals", proposalsError, { organizationId });
    return { subjects: out, proposals: inPlay };
  }

  type ProposalRow = {
    id: string;
    token: string;
    status: string;
    created_at: string;
    sent_at: string | null;
    expires_at: string | null;
    job: { id: string; cancelled_at: string | null; property: { address: string; customer_id: string | null } | null } | null;
  };
  for (const proposal of (proposals ?? []) as unknown as ProposalRow[]) {
    const property = proposal.job?.property;
    if (!property?.customer_id || proposal.job?.cancelled_at) continue;
    // Worked out in proposalFollowUpsDue, which knows about replies and
    // the five-touch plan, rather than by the plain rule arithmetic.
    inPlay.push({
      id: proposal.id,
      customerId: property.customer_id,
      status: proposal.status,
      // From the day the client got it, not the day it was written.
      sentAt: new Date(proposal.sent_at ?? proposal.created_at),
      expiresAt: proposal.expires_at ? new Date(proposal.expires_at) : null,
      facts: { subject: { kind: "proposal_follow_up", referenceId: proposal.id, customerId: property.customer_id, anchor: new Date(proposal.sent_at ?? proposal.created_at), settled: false }, when: null, address: property.address, link: `/proposal/${proposal.token}`, amount: null },
    });
  }

  // Invoices, once "Invoice reminders" is switched on, and only those raised
  // since: switching it on never chases last year's bills. Counted from the
  // due date, with the Stripe pay link in every one.
  const invoiceSetting = sequences.invoice_reminders;
  if (invoiceSetting.enabled && invoiceSetting.startedAt) {
    const { data: invoices, error: invoicesError } = await admin
      .from("invoices")
      .select("id, status, amount, sent_at, created_at, paid_at, hosted_invoice_url, pay_by, job:jobs!inner(id, cancelled_at, property:properties!inner(address, customer_id))")
      .eq("organization_id", organizationId)
      .eq("status", "open")
      .gte("created_at", invoiceSetting.startedAt.toISOString())
      .limit(500);
    if (invoicesError) {
      log.error("cron.client_reminders.invoices", invoicesError, { organizationId });
    }
    type InvoiceRow = {
      id: string;
      status: string;
      amount: number;
      sent_at: string | null;
      created_at: string;
      paid_at: string | null;
      hosted_invoice_url: string | null;
      pay_by: string | null;
      job: { id: string; cancelled_at: string | null; property: { address: string; customer_id: string | null } | null } | null;
    };
    for (const invoice of (invoices ?? []) as unknown as InvoiceRow[]) {
      const property = invoice.job?.property;
      if (!property?.customer_id || invoice.job?.cancelled_at) continue;
      if (!isLiveFor(invoiceSetting, invoice.created_at)) continue;
      const facts = { id: invoice.id, status: invoice.status, amount: Number(invoice.amount), sentAt: invoice.sent_at, createdAt: invoice.created_at, paidAt: invoice.paid_at, hostedInvoiceUrl: invoice.hosted_invoice_url, payBy: invoice.pay_by };
      if (!invoiceTakesReminders(facts)) continue;
      const dueAt = invoiceDueAt(facts);
      out.push({
        subject: {
          kind: "invoice_reminder",
          referenceId: invoice.id,
          customerId: property.customer_id,
          anchor: dueAt,
          settled: invoiceSettled(facts),
        },
        when: dueAt,
        address: property.address,
        link: invoice.hosted_invoice_url,
        amount: String(invoice.amount),
      });
    }
  }

  return { subjects: out, proposals: inPlay };
}
