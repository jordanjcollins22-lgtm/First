import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeCron } from "@/lib/cron-auth";
import { log } from "@/lib/log";
import { ensureSendingReady } from "@/lib/email/ready";
import {
  dueNow,
  mergeRules,
  type ReminderKind,
  type ReminderRule,
  type ReminderSubject,
} from "@/lib/client-reminders";
import { composeReminder, fitSms, sayWhen } from "@/lib/client-message-templates";
import {
  alreadySent,
  contactsFor,
  quietWindowFor,
  sendClientMessage,
} from "@/lib/data/client-messaging";

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
  const refused = authorizeCron(request, "client-reminders");
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

  const origin = new URL(request.url).origin;
  let sent = 0;
  let skipped = 0;
  let held = 0;

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

    const subjects = await subjectsFor(admin, org.id, now);
    if (subjects.length === 0) continue;

    // Everything the rules say is due, then everything of that we have
    // already sent taken out of it. Two steps rather than one query per
    // reminder: a run reminding forty people is a handful of queries.
    const candidates = dueNow(subjects.map((s) => s.subject), rules, new Set(), now, LATE_WINDOW_HOURS);
    if (candidates.length === 0) continue;
    const done = await alreadySent(org.id, candidates.map((c) => c.dedupeKey));
    const due = candidates.filter((c) => !done.has(c.dedupeKey));
    if (due.length === 0) continue;

    const contacts = await contactsFor(due.map((d) => d.customerId));
    const window = quietWindowFor(org);
    const byReference = new Map(subjects.map((s) => [`${s.subject.kind}:${s.subject.referenceId}`, s]));

    for (const reminder of due) {
      const contact = contacts.get(reminder.customerId);
      const facts = byReference.get(`${reminder.kind}:${reminder.referenceId}`);
      if (!contact || !facts) continue;

      const message = composeReminder(
        reminder.kind,
        reminder.channel,
        {
          businessName: org.name,
          clientName: contact.name,
          when: facts.when ? sayWhen(facts.when, window.timeZone, now) : null,
          address: facts.address,
          link: facts.link ? `${origin}${facts.link}` : null,
          amount: facts.amount,
        },
        {
          // Required on the first text to a number, and tiresome after that.
          includeOptOut: reminder.channel === "sms" && !contact.textedBefore,
          unsubscribeUrl: contact.unsubscribeToken ? `${origin}/u/${contact.unsubscribeToken}` : null,
        }
      );

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
        },
        contact,
        window,
        now
      );

      if (outcome.sent) sent += 1;
      else if (outcome.reason === "quiet_hours") held += 1;
      else skipped += 1;
    }
  }

  log.info("cron.client_reminders", { sent, skipped, held, orgs: orgs.length });
  return NextResponse.json({ sent, skipped, held });
}

/** One thing a reminder could be about, with what the wording needs. */
interface SubjectWithFacts {
  subject: ReminderSubject;
  when: Date | null;
  address: string | null;
  link: string | null;
  amount: string | null;
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
  now: Date
): Promise<SubjectWithFacts[]> {
  const out: SubjectWithFacts[] = [];
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
    return out;
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
      const anchor = new Date(job.project_start_date);
      out.push({
        subject: {
          kind: "job_start_reminder",
          referenceId: job.id,
          customerId: property.customer_id,
          anchor,
          settled: Boolean(job.completed_at),
        },
        when: anchor,
        address: property.address,
        link: null,
        amount: null,
      });
    }
  }

  // Proposals carry the business directly, so no list of job ids is needed.
  const { data: proposals, error: proposalsError } = await admin
    .from("job_proposals")
    .select("id, token, status, created_at, job:jobs!inner(id, cancelled_at, property:properties!inner(address, customer_id))")
    .eq("organization_id", organizationId)
    .eq("status", "sent")
    .gte("created_at", recently)
    .limit(500);
  if (proposalsError) {
    log.error("cron.client_reminders.proposals", proposalsError, { organizationId });
    return out;
  }

  type ProposalRow = {
    id: string;
    token: string;
    status: string;
    created_at: string;
    job: { id: string; cancelled_at: string | null; property: { address: string; customer_id: string | null } | null } | null;
  };
  for (const proposal of (proposals ?? []) as unknown as ProposalRow[]) {
    const property = proposal.job?.property;
    if (!property?.customer_id || proposal.job?.cancelled_at) continue;
    out.push({
      subject: {
        kind: "proposal_follow_up",
        referenceId: proposal.id,
        customerId: property.customer_id,
        anchor: new Date(proposal.created_at),
        settled: proposal.status !== "sent",
      },
      when: null,
      address: property.address,
      link: `/proposal/${proposal.token}`,
      amount: null,
    });
  }

  return out;
}
