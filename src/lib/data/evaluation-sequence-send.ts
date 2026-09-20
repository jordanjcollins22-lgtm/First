import type { SupabaseClient } from "@supabase/supabase-js";

import { log, maskEmail } from "@/lib/log";
import { outboundReady, sendOutbound } from "@/lib/email/outbound";
import { approvalRequired, notifyApprovers, queueApproval } from "@/lib/data/outbound-approvals";
import { staleAfter } from "@/lib/outbound-approval";
import type { Database } from "@/lib/supabase/database.types";

/**
 * The emails around a booked evaluation, sent when they are due.
 *
 * The database says what is due: which step, for whom, with the words
 * already filled in. This claims each one so no other run can send it,
 * sends it as the business, and records the message id so the next step
 * threads under the first. Run it as often as you like; a step is sent once.
 *
 * Two callers. The cron, twice a day, for everything. And the moment
 * somebody books, for that one job, so "you are booked" arrives while
 * they still have the page open rather than at lunchtime.
 */
export interface DueStep {
  organization_id: string;
  job_id: string;
  customer_id: string;
  step: string;
  dedupe_key: string;
  to_email: string;
  to_name: string | null;
  subject: string;
  body: string;
  reply_thread_id: string | null;
  fire_at: string;
}

export interface SequenceCounts {
  due: number;
  sent: number;
  failed: number;
  claimedElsewhere: number;
  notReady: number;
  /** Parked for the owner to read first. */
  held: number;
  why: string | null;
}

export async function sendDueEvaluationEmails(
  admin: SupabaseClient<Database>,
  options: { jobId?: string } = {}
): Promise<SequenceCounts> {
  const { data: rows, error } = await admin.rpc("evaluation_sequence_due");
  if (error) throw error;
  const all = (rows ?? []) as DueStep[];
  const due = options.jobId ? all.filter((item) => item.job_id === options.jobId) : all;

  const orgNames = new Map<string, { name: string; email: string | null }>();
  const ready = new Map<string, { ready: boolean; why: string }>();
  const gated = new Map<string, boolean>();
  const heldFor = new Set<string>();
  const counts: SequenceCounts = { due: due.length, sent: 0, failed: 0, claimedElsewhere: 0, notReady: 0, held: 0, why: null };

  for (const item of due) {
    if (!orgNames.has(item.organization_id)) {
      const { data: org } = await admin.from("organizations").select("name, business_email").eq("id", item.organization_id).maybeSingle();
      orgNames.set(item.organization_id, { name: org?.name ?? "JS Landscaping MD", email: org?.business_email ?? null });
      ready.set(item.organization_id, await outboundReady(item.organization_id));
      gated.set(item.organization_id, await approvalRequired(admin, item.organization_id));
    }
    const org = orgNames.get(item.organization_id)!;

    // Nothing is claimed until something can send it. A step claimed and
    // then failed would be marked failed and never retried; a step left
    // unclaimed is sent on the first run after the domain is ready.
    const can = ready.get(item.organization_id)!;
    if (!can.ready) {
      counts.notReady += 1;
      counts.why = can.why;
      continue;
    }

    // Claimed first. A second run starting before this one finishes must
    // find the row taken.
    const { data: claimed, error: claimError } = await admin.rpc("evaluation_sequence_claim", {
      p_organization_id: item.organization_id,
      p_customer_id: item.customer_id,
      p_job_id: item.job_id,
      p_step: item.step,
      p_dedupe_key: item.dedupe_key,
      p_body: item.body,
    });
    if (claimError || !claimed) {
      counts.claimedElsewhere += 1;
      continue;
    }

    // Parked, not sent, where the business wants to read first. The claim
    // stands so no run sends it behind the owner's back; the log says why
    // it is sitting there.
    if (gated.get(item.organization_id)) {
      await queueApproval(admin, {
        organizationId: item.organization_id,
        source: "evaluation_sequence",
        kind: `evaluation_${item.step}`,
        dedupeKey: item.dedupe_key,
        customerId: item.customer_id,
        jobId: item.job_id,
        toEmail: item.to_email,
        toName: item.to_name,
        subject: item.subject,
        body: item.body,
        payload: { step: item.step, reply_thread_id: item.reply_thread_id },
        expiresAt: staleAfter(`evaluation_${item.step}`, new Date()),
      });
      await admin.from("client_message_log").update({ detail: "awaiting approval" }).eq("dedupe_key", item.dedupe_key);
      counts.held += 1;
      heldFor.add(item.organization_id);
      continue;
    }

    const sent = await sendOutbound({
      organizationId: item.organization_id,
      to: item.to_email,
      toName: item.to_name,
      subject: item.subject,
      text: item.body,
      fromName: org.name,
      inReplyTo: item.reply_thread_id,
    });

    if (sent.ok) {
      await admin.rpc("evaluation_sequence_sent", {
        p_dedupe_key: item.dedupe_key,
        p_message_id: sent.id,
        // The first email's id is the thread; later steps reply to it.
        p_thread_id: item.reply_thread_id ?? sent.id,
      });
      counts.sent += 1;
      log.info("evaluation.email.sent", { jobId: item.job_id, step: item.step, via: sent.via, to: maskEmail(item.to_email) });
    } else {
      await admin.rpc("evaluation_sequence_failed", { p_dedupe_key: item.dedupe_key, p_detail: sent.message });
      counts.failed += 1;
      log.warn("evaluation.email.failed", { jobId: item.job_id, step: item.step, error: sent.message });
    }
  }

  for (const organizationId of heldFor) {
    await notifyApprovers(admin, organizationId).catch((err) => {
      log.warn("approvals.notify_failed", { organizationId, error: err instanceof Error ? err.message : String(err) });
    });
  }

  return counts;
}

/** The key the sequence's "you are booked" email is logged under, per channel. */
export function bookedSequenceKey(jobId: string, channel: string): string {
  return `evaluation_sequence:${jobId}:booked:${channel}`;
}
