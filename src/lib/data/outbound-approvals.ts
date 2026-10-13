import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { threadSentEmail } from "@/lib/data/thread-email";
import { outboundBaseUrl } from "@/lib/base-url";
import { sendEmail } from "@/lib/email/send";
import { sendOutbound } from "@/lib/email/outbound";
import { textToHtml } from "@/lib/email/plain";
import { log, maskEmail } from "@/lib/log";
import { digest, type ApprovalSource } from "@/lib/outbound-approval";
import { dueToAutoSend } from "@/lib/approvals/policy";
import { MOOT_LABEL, type MootReason } from "@/lib/approvals/moot";
import type { DeclineReason } from "@/lib/approvals/declines";
import { mootFor } from "@/lib/data/approval-policy";
import type { Database } from "@/lib/supabase/database.types";

type Admin = SupabaseClient<Database>;

export interface PendingApproval {
  id: string;
  source: ApprovalSource;
  kind: string;
  toEmail: string;
  toName: string | null;
  subject: string;
  body: string;
  jobId: string | null;
  customerId: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/**
 * Whether this business wants to read everything before it goes: the old
 * org-wide switch, which is now the master hold. Callers deciding about one
 * email ask holdDecisionFor (src/lib/data/approval-policy.ts) instead, which
 * applies this switch and the per-kind policy together.
 */
export async function approvalRequired(admin: Admin, organizationId: string): Promise<boolean> {
  const { data } = await admin.from("organizations").select("require_email_approval").eq("id", organizationId).maybeSingle();
  return Boolean(data?.require_email_approval);
}

/**
 * Park one email. The key is the same one the send is logged under, so the
 * same email cannot be parked twice however many runs notice it.
 */
export async function queueApproval(
  admin: Admin,
  input: {
    organizationId: string;
    source: ApprovalSource;
    kind: string;
    dedupeKey: string;
    customerId: string | null;
    jobId: string | null;
    toEmail: string;
    toName: string | null;
    subject: string;
    body: string;
    payload?: Record<string, unknown>;
    expiresAt: Date | null;
    /** Goes on its own at autoSendAt if nobody has said no. */
    sendOnExpiry?: boolean;
    autoSendAt?: Date | null;
  }
): Promise<"queued" | "already"> {
  // The two policy columns are newer than database.types.ts, and are only
  // written when they say something, so an email parked the old way is
  // written exactly as it always was.
  const policy = input.sendOnExpiry && input.autoSendAt ? { send_on_expiry: true, auto_send_at: input.autoSendAt.toISOString() } : {};
  const { data, error } = await (admin as unknown as SupabaseClient)
    .from("outbound_approvals")
    .upsert(
      {
        ...policy,
        organization_id: input.organizationId,
        source: input.source,
        kind: input.kind,
        dedupe_key: input.dedupeKey,
        customer_id: input.customerId,
        job_id: input.jobId,
        to_email: input.toEmail,
        to_name: input.toName,
        subject: input.subject,
        body: input.body,
        payload: (input.payload ?? {}) as Database["public"]["Tables"]["outbound_approvals"]["Row"]["payload"],
        expires_at: input.expiresAt ? input.expiresAt.toISOString() : null,
      },
      { onConflict: "organization_id,dedupe_key", ignoreDuplicates: true }
    )
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0 ? "queued" : "already";
}

/** Everything waiting for the signed-in business. */
export async function listPendingApprovals(): Promise<PendingApproval[]> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const { data } = await supabase
    .from("outbound_approvals")
    .select("id, source, kind, to_email, to_name, subject, body, job_id, customer_id, expires_at, created_at")
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);
  return (data ?? []).map((row) => ({
    id: row.id,
    source: row.source as ApprovalSource,
    kind: row.kind,
    toEmail: row.to_email,
    toName: row.to_name,
    subject: row.subject,
    body: row.body,
    jobId: row.job_id,
    customerId: row.customer_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

/**
 * Tell the owner something is waiting.
 *
 * One note per batch, to the business's own inbox, listing what is parked
 * and how long each has. Called by whoever parked a batch, once, rather than
 * once per email.
 */
export async function notifyApprovers(admin: Admin, organizationId: string): Promise<void> {
  const [{ data: org }, { data: rows }] = await Promise.all([
    admin.from("organizations").select("name, business_email").eq("id", organizationId).maybeSingle(),
    admin
      .from("outbound_approvals")
      .select("to_email, to_name, kind, expires_at")
      .eq("organization_id", organizationId)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(50),
  ]);
  const to = org?.business_email?.trim();
  if (!to || !rows || rows.length === 0) return;

  // Straight to the approvals on My Day. A signed-out phone goes through
  // the sign-in page and comes back here rather than to the front door.
  const link = `${await outboundBaseUrl()}/my-day#approvals`;
  const note = digest({
    items: rows.map((row) => ({ toName: row.to_name, toEmail: row.to_email, kind: row.kind, expiresAt: row.expires_at })),
    link,
    now: new Date(),
  });
  const sent = await sendEmail({
    organizationId,
    to,
    subject: note.subject,
    html: textToHtml(note.text),
    text: note.text,
    stream: "transactional",
  });
  if (sent.ok) log.info("approvals.notified", { organizationId, waiting: rows.length, to: maskEmail(to) });
  else log.warn("approvals.notify_failed", { organizationId, error: sent.message });
}

/**
 * Everything the clock decides about held emails, in one pass.
 *
 * First the ones that stopped making sense (the booking was cancelled, the
 * proposal was answered) are closed, so nobody is asked about them. Then
 * low-risk ones nobody stopped in time go out on their own. Then whatever
 * is past its moment is closed unsent, as before.
 */
export async function sweepApprovals(admin: Admin, now = new Date()): Promise<{ moot: number; autoSent: number; expired: number }> {
  const moot = await closeMootApprovals(admin, now).catch(() => 0);
  const autoSent = await autoSendDueApprovals(admin, now).catch(() => 0);
  const expired = await expireOnly(admin, now);
  return { moot, autoSent, expired };
}

/** Kept for the crons that already call it: now the whole sweep. */
export async function expireStaleApprovals(admin: Admin, now = new Date()): Promise<number> {
  const result = await sweepApprovals(admin, now);
  return result.expired;
}

type ApprovalCheckRow = Pick<ApprovalRow, "id" | "source" | "dedupe_key" | "organization_id" | "customer_id" | "kind" | "job_id" | "body" | "payload">;

/** Why a held email no longer makes sense, read from its job or proposal. */
export async function mootForApproval(admin: Admin, row: ApprovalCheckRow, now = new Date()): Promise<MootReason | null> {
  const payload = (row.payload ?? {}) as { reference_id?: string | null; evaluation_at?: string | null };
  const reference = payload.reference_id ?? null;
  return mootFor(admin, {
    organizationId: row.organization_id,
    kind: row.kind,
    jobId: row.job_id ?? (row.kind === "proposal_follow_up" ? null : reference),
    proposalId: row.kind === "proposal_follow_up" ? reference : null,
    writtenForEvaluationAt: payload.evaluation_at ?? null,
    now,
  });
}

/** Held emails whose reason to exist has gone. Closed before anybody is asked. */
async function closeMootApprovals(admin: Admin, now: Date): Promise<number> {
  const { data: rows } = await admin
    .from("outbound_approvals")
    .select("id, source, dedupe_key, organization_id, customer_id, kind, job_id, body, payload")
    .eq("status", "pending")
    .neq("source", "team_request")
    .order("created_at", { ascending: true })
    .limit(100);
  let closed = 0;
  for (const row of rows ?? []) {
    const reason = await mootForApproval(admin, row, now);
    if (!reason) continue;
    await closeAsMoot(admin, row, reason);
    closed += 1;
  }
  if (closed > 0) log.info("approvals.moot_closed", { closed });
  return closed;
}

/** Close one unsent because the app can see it no longer makes sense. */
export async function closeAsMoot(admin: Admin, row: ApprovalCheckRow, reason: MootReason): Promise<void> {
  await settle(admin, row, { status: "expired", detail: MOOT_LABEL[reason], moot: reason });
}

/**
 * Low-risk emails the owner had a window to stop and did not. Each is
 * checked again before it goes, through the same sender as an approval.
 */
async function autoSendDueApprovals(admin: Admin, now: Date): Promise<number> {
  const { data } = await (admin as unknown as SupabaseClient)
    .from("outbound_approvals")
    .select("*")
    .eq("status", "pending")
    .eq("send_on_expiry", true)
    .lte("auto_send_at", now.toISOString())
    .order("auto_send_at", { ascending: true })
    .limit(50);
  let sent = 0;
  for (const row of (data ?? []) as (ApprovalRow & { send_on_expiry: boolean; auto_send_at: string | null })[]) {
    if (!dueToAutoSend({ sendOnExpiry: row.send_on_expiry, autoSendAt: row.auto_send_at, expiresAt: row.expires_at }, now)) continue;
    const result = await deliverApproval(admin, row, null);
    if (result.ok) sent += 1;
  }
  if (sent > 0) log.info("approvals.auto_sent", { sent });
  return sent;
}

/** Rows whose moment has passed. Closed unsent, and said so in the log. */
async function expireOnly(admin: Admin, now: Date): Promise<number> {
  const { data: stale } = await admin
    .from("outbound_approvals")
    .select("id, source, dedupe_key, organization_id, customer_id, kind, job_id, body")
    .eq("status", "pending")
    .lt("expires_at", now.toISOString())
    .limit(200);
  let closed = 0;
  for (const row of stale ?? []) {
    await settle(admin, row, { status: "expired", detail: "Not approved in time." });
    closed += 1;
  }
  if (closed > 0) log.info("approvals.expired", { closed });
  return closed;
}

type ApprovalRow = Database["public"]["Tables"]["outbound_approvals"]["Row"];

/**
 * Send one that was approved, and write down what happened.
 *
 * decidedBy is null when nobody did: a low-risk email sent because its
 * window closed. Either way it is checked once more first, because an
 * approval given on Monday should not send Tuesday's cancelled visit.
 */
export async function deliverApproval(admin: Admin, approval: ApprovalRow, decidedBy: string | null): Promise<{ ok: boolean; message: string }> {
  const payload = (approval.payload ?? {}) as { reply_thread_id?: string | null; reference_id?: string | null };
  const now = new Date().toISOString();

  if (approval.source !== "team_request") {
    const reason = await mootForApproval(admin, approval).catch(() => null);
    if (reason) {
      await closeAsMoot(admin, approval, reason);
      // Worded so the existing list takes the row away, as it does for one
      // that went stale.
      return { ok: false, message: `Too late for that one, so it was closed unsent: ${MOOT_LABEL[reason].toLowerCase()}` };
    }
  }

  if (approval.source === "evaluation_sequence") {
    const { data: org } = await admin.from("organizations").select("name").eq("id", approval.organization_id).maybeSingle();
    const sent = await sendOutbound({
      organizationId: approval.organization_id,
      to: approval.to_email,
      toName: approval.to_name,
      subject: approval.subject,
      text: approval.body,
      fromName: org?.name ?? "",
      inReplyTo: payload.reply_thread_id ?? null,
    });
    if (sent.ok) {
      await threadSentEmail(admin, { organizationId: approval.organization_id, jobId: approval.job_id, customerId: approval.customer_id, subject: approval.subject, body: approval.body });
      await admin.rpc("evaluation_sequence_sent", {
        p_dedupe_key: approval.dedupe_key,
        p_message_id: sent.id,
        p_thread_id: payload.reply_thread_id ?? sent.id,
      });
      await admin
        .from("outbound_approvals")
        .update({ status: "sent", decided_at: now, decided_by: decidedBy, sent_at: now, provider_id: sent.id })
        .eq("id", approval.id);
      return { ok: true, message: "Sent." };
    }
    await admin.rpc("evaluation_sequence_failed", { p_dedupe_key: approval.dedupe_key, p_detail: sent.message });
    await admin
      .from("outbound_approvals")
      .update({ status: "failed", decided_at: now, decided_by: decidedBy, detail: sent.message })
      .eq("id", approval.id);
    return { ok: false, message: sent.message };
  }

  const sent = await sendEmail({
    organizationId: approval.organization_id,
    to: approval.to_email,
    subject: approval.subject,
    html: textToHtml(approval.body),
    text: approval.body,
    stream: "transactional",
  });
  // A note to somebody on the team is not client correspondence.
  if (approval.source !== "team_request") await admin.from("client_message_log").upsert(
    {
      organization_id: approval.organization_id,
      customer_id: approval.customer_id,
      channel: "email",
      kind: approval.kind,
      reference_id: payload.reference_id ?? approval.job_id,
      dedupe_key: approval.dedupe_key,
      status: sent.ok ? "sent" : "failed",
      skip_reason: null,
      detail: sent.ok ? null : sent.message,
      provider_id: sent.ok ? sent.id : null,
      body: approval.body,
    },
    { onConflict: "organization_id,dedupe_key" }
  );
  await admin
    .from("outbound_approvals")
    .update(
      sent.ok
        ? { status: "sent", decided_at: now, decided_by: decidedBy, sent_at: now, provider_id: sent.id }
        : { status: "failed", decided_at: now, decided_by: decidedBy, detail: sent.message }
    )
    .eq("id", approval.id);
  if (sent.ok && approval.source !== "team_request") {
    await threadSentEmail(admin, {
      organizationId: approval.organization_id,
      jobId: approval.job_id ?? payload.reference_id ?? null,
      customerId: approval.customer_id,
      subject: approval.subject,
      body: approval.body,
    });
  }
  // The proposal is sent from this moment, not from its approval.
  if (sent.ok && approval.kind === "proposal_ready" && approval.job_id) {
    await admin.from("job_proposals").update({ sent_at: now }).eq("job_id", approval.job_id).is("sent_at", null);
  }
  return sent.ok ? { ok: true, message: "Sent." } : { ok: false, message: sent.message };
}

/** Close one unsent, by a person or by the clock. */
export async function settle(
  admin: Admin,
  approval: Pick<ApprovalRow, "id" | "source" | "dedupe_key" | "organization_id" | "customer_id" | "kind" | "job_id" | "body">,
  outcome: { status: "declined" | "expired"; detail: string; decidedBy?: string; declineReason?: DeclineReason; moot?: MootReason }
): Promise<void> {
  const now = new Date().toISOString();
  if (approval.source === "evaluation_sequence") {
    await admin.rpc("evaluation_sequence_failed", { p_dedupe_key: approval.dedupe_key, p_detail: outcome.detail });
  } else {
    await admin.from("client_message_log").upsert(
      {
        organization_id: approval.organization_id,
        customer_id: approval.customer_id,
        channel: "email",
        kind: approval.kind,
        reference_id: approval.job_id,
        dedupe_key: approval.dedupe_key,
        status: "skipped",
        skip_reason: outcome.moot ? "moot" : outcome.status === "declined" ? "declined" : "not_approved_in_time",
        detail: outcome.detail,
        body: approval.body,
      },
      { onConflict: "organization_id,dedupe_key" }
    );
  }
  // The reason columns are newer than database.types.ts.
  await (admin as unknown as SupabaseClient)
    .from("outbound_approvals")
    .update({
      status: outcome.status,
      decided_at: now,
      decided_by: outcome.decidedBy ?? null,
      detail: outcome.detail,
      ...(outcome.declineReason ? { decline_reason: outcome.declineReason } : {}),
      ...(outcome.moot ? { moot_reason: outcome.moot } : {}),
    })
    .eq("id", approval.id)
    .eq("status", "pending");
}
