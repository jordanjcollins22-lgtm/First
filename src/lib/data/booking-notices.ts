import { createAdminClient } from "@/lib/supabase/admin";
import { outboundBaseUrl } from "@/lib/base-url";
import { isSmsConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import { dedupeKeyFor, mergeRules, type ReminderKind, type ReminderRule } from "@/lib/client-reminders";
import { composeReminder, fitSms, sayWhen } from "@/lib/client-message-templates";
import { alreadySent, contactsFor, quietWindowFor, sendClientMessage } from "@/lib/data/client-messaging";
import { bookedSequenceKey, sendDueEvaluationEmails } from "@/lib/data/evaluation-sequence-send";
import { notifyApprovers } from "@/lib/data/outbound-approvals";

/**
 * "You're booked", the moment they are.
 *
 * The confirmation was left to the daily reminder run, which meant a client
 * who booked at nine in the morning heard nothing until the next day. It goes
 * now, on the same rule and the same key the cron uses, so the cron finds it
 * already sent and does not send it twice. Quiet hours still hold it; the
 * cron picks it up in the morning.
 *
 * Never throws, never fails the booking. A confirmation that could not go is
 * logged and left for the cron.
 */
export async function sendEvaluationConfirmationNow(jobId: string): Promise<void> {
  try {
    const admin = createAdminClient();

    // The evaluation email sequence owns "you are booked". It used to wait
    // for its twice-daily run; now it goes for this job the moment the
    // booking lands, and the reminder rule below only fills in when the
    // sequence sent nothing.
    await sendDueEvaluationEmails(admin, { jobId }).catch((err) => {
      log.warn("booking.sequence.failed", { jobId, error: err instanceof Error ? err.message : String(err) });
    });

    const { data } = await admin
      .from("jobs")
      .select("id, evaluation_date, evaluation_status, property:properties(address, customer:customers(id, organization_id))")
      .eq("id", jobId)
      .maybeSingle();
    const job = data as unknown as {
      id: string;
      evaluation_date: string | null;
      evaluation_status: string;
      property: { address: string; customer: { id: string; organization_id: string } | null } | null;
    } | null;
    if (!job?.evaluation_date || job.evaluation_status === "cancelled" || !job.property?.customer) return;
    // Nothing to confirm about a visit that has already happened.
    if (new Date(job.evaluation_date).getTime() <= Date.now()) return;
    const customerId = job.property.customer.id;
    const organizationId = job.property.customer.organization_id;

    const [{ data: org }, { data: storedRules }] = await Promise.all([
      admin
        .from("organizations")
        .select("id, name, client_reminders_enabled, reminder_time_zone, reminder_quiet_start, reminder_quiet_end")
        .eq("id", organizationId)
        .maybeSingle(),
      admin.from("reminder_rules").select("kind, enabled, channels, offsets_hours").eq("organization_id", organizationId),
    ]);
    if (!org?.client_reminders_enabled) return;

    const rules = mergeRules(
      (storedRules ?? []).map((row) => ({
        kind: row.kind as ReminderKind,
        enabled: row.enabled,
        channels: (row.channels ?? []) as ReminderRule["channels"],
        offsetsHours: row.offsets_hours ?? [],
      }))
    );
    const rule = rules.find((r) => r.kind === "evaluation_confirmed");
    if (!rule?.enabled || !rule.offsetsHours.includes(0)) return;

    const contact = (await contactsFor([customerId])).get(customerId);
    if (!contact) return;
    const window = quietWindowFor(org);
    const now = new Date();
    const origin = await outboundBaseUrl();

    // Whatever the sequence already said, on whichever channel, is said.
    const said = await alreadySent(organizationId, rule.channels.map((channel) => bookedSequenceKey(job.id, channel)));

    for (const channel of rule.channels) {
      // A text with no text provider is a skipped row in the log for nothing.
      if (channel === "sms" && !isSmsConfigured) continue;
      if (said.has(bookedSequenceKey(job.id, channel))) continue;
      const message = composeReminder(
        "evaluation_confirmed",
        channel,
        {
          businessName: org.name,
          clientName: contact.name,
          when: sayWhen(new Date(job.evaluation_date), window.timeZone, now),
          address: job.property.address,
          link: null,
          amount: null,
        },
        {
          includeOptOut: channel === "sms" && !contact.textedBefore,
          unsubscribeUrl: contact.unsubscribeToken ? `${origin}/u/${contact.unsubscribeToken}` : null,
        }
      );
      const outcome = await sendClientMessage(
        {
          organizationId,
          customerId,
          channel,
          basis: "service",
          kind: "evaluation_confirmed",
          referenceId: job.id,
          dedupeKey: dedupeKeyFor("evaluation_confirmed", job.id, 0, channel),
          subject: message.subject,
          body: channel === "sms" ? fitSms(message.body) : message.body,
          automatic: true,
        },
        contact,
        window,
        now
      );
      log.info("booking.confirmation", { jobId, channel, sent: outcome.sent, reason: outcome.sent ? null : outcome.reason });
      if (!outcome.sent && outcome.reason === "awaiting_approval") {
        await notifyApprovers(admin, organizationId).catch(() => undefined);
      }
    }
  } catch (err) {
    log.warn("booking.confirmation.failed", { jobId, error: err instanceof Error ? err.message : String(err) });
  }
}
