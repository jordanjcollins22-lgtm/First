import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { outboundBaseUrl } from "@/lib/base-url";
import { sendEmail } from "@/lib/email/send";
import { sendOutbound } from "@/lib/email/outbound";
import { textToHtml } from "@/lib/email/plain";
import { log, maskEmail } from "@/lib/log";
import { digest, type ApprovalSource } from "@/lib/outbound-approval";
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

/** Whether this business wants to read everything before it goes. */
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
  }
): Promise<"queued" | "already"> {
  const { data, error } = await admin
    .from("outbound_approvals")
    .upsert(
      {
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

  const link = `${await outboundBaseUrl()}/my-day`;
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

/** Rows whose moment has passed. Closed unsent, and said so in the log. */
export async function expireStaleApprovals(admin: Admin, now = new Date()): Promise<number> {
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

/** Send one that was approved, and write down what happened. */
export async function deliverApproval(admin: Admin, approval: ApprovalRow, decidedBy: string): Promise<{ ok: boolean; message: string }> {
  const payload = (approval.payload ?? {}) as { reply_thread_id?: string | null; reference_id?: string | null };
  const now = new Date().toISOString();

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
  return sent.ok ? { ok: true, message: "Sent." } : { ok: false, message: sent.message };
}

/** Close one unsent, by a person or by the clock. */
export async function settle(
  admin: Admin,
  approval: Pick<ApprovalRow, "id" | "source" | "dedupe_key" | "organization_id" | "customer_id" | "kind" | "job_id" | "body">,
  outcome: { status: "declined" | "expired"; detail: string; decidedBy?: string }
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
        skip_reason: outcome.status === "declined" ? "declined" : "not_approved_in_time",
        detail: outcome.detail,
        body: approval.body,
      },
      { onConflict: "organization_id,dedupe_key" }
    );
  }
  await admin
    .from("outbound_approvals")
    .update({ status: outcome.status, decided_at: now, decided_by: outcome.decidedBy ?? null, detail: outcome.detail })
    .eq("id", approval.id)
    .eq("status", "pending");
}
