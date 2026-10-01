"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { isOwnerLevel } from "@/lib/roles";
import { isAccountManager } from "@/lib/affiliate-roles";
import { outboundBaseUrl } from "@/lib/base-url";
import { appUrl } from "@/lib/app-url";
import { intakePath } from "@/lib/data/evaluation-intake";
import { sendOutbound } from "@/lib/email/outbound";
import { refuseInDemo } from "@/lib/demo-mode";
import { log, maskEmail } from "@/lib/log";
import { dateKeyIn } from "@/lib/time-zone";
import { preEvalAskEmail } from "@/lib/pre-eval-ask";

/**
 * The account manager's button for a client who has not filled out the
 * pre-evaluation form: see the email, then send it. The preview is built by
 * the same code as the send, so what they read is what goes.
 */

export type PreEvalAskPreview = { ok: true; to: string; subject: string; body: string } | { ok: false; message: string };
export type PreEvalAskResult = { ok: true; message: string } | { ok: false; message: string };

type Draft = { organizationId: string; customerId: string; to: string; toName: string | null; subject: string; body: string; business: string };

async function draftFor(jobId: string): Promise<{ ok: true; draft: Draft } | { ok: false; message: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin") && !isAccountManager(profile.roles)) {
    return { ok: false, message: "Only an owner, admin or account manager can send this." };
  }

  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const [{ data: job }, { data: intake }, { data: org }] = await Promise.all([
    supabase
      .from("jobs")
      .select("evaluation_date, evaluation_status, status, assignee:profiles!jobs_assigned_to_fkey(full_name), properties(address, customers(id, name, email, do_not_contact))")
      .eq("id", jobId)
      .maybeSingle(),
    supabase.from("evaluation_intakes").select("token, submitted_at").eq("job_id", jobId).maybeSingle(),
    supabase.from("organizations").select("name, business_phone").eq("id", organizationId).maybeSingle(),
  ]);
  const row = job as unknown as {
    evaluation_date: string | null;
    evaluation_status: string;
    status: string;
    assignee: { full_name: string | null } | null;
    properties: { address: string | null; customers: { id: string; name: string | null; email: string | null; do_not_contact: boolean | null } | null } | null;
  } | null;
  if (!row?.evaluation_date) return { ok: false, message: "Couldn't find that evaluation." };
  if (row.status === "cancelled" || row.evaluation_status === "cancelled") return { ok: false, message: "That evaluation is cancelled." };
  if (!intake?.token) return { ok: false, message: "This evaluation has no pre-evaluation form." };
  if (intake.submitted_at) return { ok: false, message: "They've already filled it out." };
  const customer = row.properties?.customers;
  if (!customer) return { ok: false, message: "No client on this job." };
  if (customer.do_not_contact) return { ok: false, message: "This client asked not to be contacted." };
  const to = customer.email?.trim();
  if (!to) return { ok: false, message: "No email for this client. Add one on their account first." };

  const business = org?.name ?? "JS Landscaping MD";
  const { subject, body } = preEvalAskEmail({
    clientName: customer.name,
    address: row.properties?.address ?? "",
    dueAt: row.evaluation_date,
    evaluator: row.assignee?.full_name?.trim().split(/\s+/)[0] ?? null,
    link: appUrl(await outboundBaseUrl(), intakePath(intake.token)),
    sender: profile.full_name || null,
    business,
    phone: org?.business_phone ?? null,
    now: new Date(),
  });
  return { ok: true, draft: { organizationId, customerId: customer.id, to, toName: customer.name, subject, body, business } };
}

/** The email, word for word, before anything is sent. */
export async function previewPreEvalAsk(jobId: string): Promise<PreEvalAskPreview> {
  const made = await draftFor(jobId);
  if (!made.ok) return made;
  return { ok: true, to: made.draft.to, subject: made.draft.subject, body: made.draft.body };
}

/** Sends it. Once a day per evaluation, so a double tap is one email. */
export async function sendPreEvalAsk(jobId: string): Promise<PreEvalAskResult> {
  await refuseInDemo();
  const made = await draftFor(jobId);
  if (!made.ok) return made;
  const { draft } = made;
  const supabase = await createClient();

  // Claimed before it is sent: the unique key stops a second send today.
  const dedupeKey = `pre_eval_ask:${jobId}:${dateKeyIn(new Date())}`;
  const claim = await supabase.from("client_message_log").insert({
    organization_id: draft.organizationId,
    customer_id: draft.customerId,
    channel: "email",
    kind: "pre_eval_ask",
    reference_id: jobId,
    dedupe_key: dedupeKey,
    status: "sent",
    body: draft.body,
  });
  if (claim.error) return { ok: false, message: "Already sent to them today." };

  const sent = await sendOutbound({
    organizationId: draft.organizationId,
    to: draft.to,
    toName: draft.toName,
    subject: draft.subject,
    text: draft.body,
    fromName: draft.business,
  });
  if (!sent.ok) {
    await supabase.from("client_message_log").update({ status: "failed", detail: sent.message }).eq("dedupe_key", dedupeKey).eq("organization_id", draft.organizationId);
    return { ok: false, message: `It didn't send: ${sent.message}` };
  }
  await supabase.from("client_message_log").update({ provider_id: sent.id }).eq("dedupe_key", dedupeKey).eq("organization_id", draft.organizationId);
  log.info("pre_eval_ask.sent", { jobId, to: maskEmail(draft.to), via: sent.via });
  revalidatePath("/my-day");
  return { ok: true, message: `Sent to ${draft.to}.` };
}
