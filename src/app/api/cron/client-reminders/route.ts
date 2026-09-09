import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { env, isSupabaseAdminConfigured } from "@/lib/env";
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
  const secret = env.cronSecret;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const { data: customers } = await admin
    .from("customers")
    .select("id")
    .eq("organization_id", organizationId);
  const customerIds = (customers ?? []).map((row) => row.id);
  if (customerIds.length === 0) return out;

  const { data: properties } = await admin
    .from("properties")
    .select("id, address, customer_id")
    .in("customer_id", customerIds);
  const propertyById = new Map((properties ?? []).map((row) => [row.id, row]));
  if (propertyById.size === 0) return out;

  const { data: jobs } = await admin
    .from("jobs")
    .select("id, property_id, evaluation_date, evaluation_status, project_start_date, cancelled_at, completed_at")
    .in("property_id", [...propertyById.keys()])
    .is("cancelled_at", null)
    .limit(1000);

  for (const job of jobs ?? []) {
    const property = job.property_id ? propertyById.get(job.property_id) : undefined;
    if (!property?.customer_id) continue;

    if (job.evaluation_date) {
      const anchor = new Date(job.evaluation_date);
      const settled = job.evaluation_status === "cancelled";
      for (const kind of ["evaluation_confirmed", "evaluation_reminder"] as ReminderKind[]) {
        out.push({
          subject: { kind, referenceId: job.id, customerId: property.customer_id, anchor, settled },
          when: anchor,
          address: property.address,
          link: null,
          amount: null,
        });
      }
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

  const jobById = new Map((jobs ?? []).map((job) => [job.id, job]));
  const { data: proposals } = await admin
    .from("job_proposals")
    .select("id, token, status, created_at, job_id")
    .in("job_id", [...jobById.keys()])
    .eq("status", "sent")
    .gte("created_at", recently)
    .limit(500);

  for (const proposal of proposals ?? []) {
    const job = proposal.job_id ? jobById.get(proposal.job_id) : undefined;
    const property = job?.property_id ? propertyById.get(job.property_id) : undefined;
    if (!property?.customer_id) continue;
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
