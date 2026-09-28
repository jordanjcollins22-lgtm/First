"use server";

import { revalidatePath } from "next/cache";

import { revalidateJobViews } from "@/lib/revalidate-job";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { deliverApproval, queueApproval } from "@/lib/data/outbound-approvals";
import { closeoutInputFor } from "@/lib/data/client-review";
import { getJobCustomerContact } from "@/lib/job-customer";
import { outboundBaseUrl } from "@/lib/base-url";
import { isOwnerLevel } from "@/lib/roles";
import { isAccountManager } from "@/lib/affiliate-roles";
import { beforeAfterEmail, canSendForApproval, canSignOffProject, clientReviewPath } from "@/lib/project-closeout";

export type ReviewResult = { ok: true; message: string } | { ok: false; message: string };

async function closer() {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Sign in first." } as const;
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin") && !isAccountManager(profile.roles)) {
    return { error: "Only an owner, admin or account manager can close a job." } as const;
  }
  return { profile } as const;
}

function refresh(jobId: string) {
  revalidateJobViews(jobId);
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/photos`);
}

/**
 * The befores and afters to the client, on one link, sent at once.
 *
 * Only once the job has been walked and every area has its after: the
 * client is being asked whether they are happy with finished work, so it
 * has to be finished. Pressing Send is the approval; nothing is parked.
 */
export async function sendBeforeAftersToClient(jobId: string): Promise<ReviewResult> {
  const who = await closer();
  if ("error" in who) return { ok: false, message: who.error! };
  const { profile } = who;

  const state = await closeoutInputFor(jobId);
  if (!state) return { ok: false, message: "Couldn't find that job." };
  const verdict = canSendForApproval(state.input);
  if (!verdict.ok) return { ok: false, message: verdict.reason };

  const contact = await getJobCustomerContact(jobId);
  const to = contact?.email?.trim();
  if (!contact || !to) {
    return { ok: false, message: "The client has no email on file. Show them in person and record their approval instead." };
  }

  const admin = createAdminClient();
  const { data: review, error } = await admin
    .from("job_client_reviews")
    .insert({ organization_id: contact.organizationId, job_id: jobId, sent_to: to, sent_by: profile.id })
    .select("id, token")
    .single();
  if (error || !review) return { ok: false, message: "Couldn't start the approval. Try again." };

  const { data: org } = await admin.from("organizations").select("name").eq("id", contact.organizationId).maybeSingle();
  const signedBy = (profile.first_name || profile.full_name || "").trim().split(/\s+/)[0] || null;
  const email = beforeAfterEmail({
    clientName: contact.customerName,
    businessName: org?.name ?? "",
    link: `${await outboundBaseUrl()}${clientReviewPath(review.token)}`,
    signedBy,
  });

  const dedupeKey = `before_after_review:${review.id}`;
  await queueApproval(admin, {
    organizationId: contact.organizationId,
    source: "client_reminder",
    kind: "before_after_review",
    dedupeKey,
    customerId: contact.customerId,
    jobId,
    toEmail: to,
    toName: contact.customerName,
    subject: email.subject,
    body: email.text,
    payload: { reference_id: jobId },
    expiresAt: null,
  });
  const { data: row } = await admin
    .from("outbound_approvals")
    .select("*")
    .eq("organization_id", contact.organizationId)
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  if (!row) return { ok: false, message: "Couldn't send it. Try again." };

  const sent = await deliverApproval(admin, row, profile.id);
  if (!sent.ok) {
    // Nothing reached them, so nothing is waiting on them.
    await admin.from("job_client_reviews").delete().eq("id", review.id);
    return { ok: false, message: sent.message };
  }
  refresh(jobId);
  return { ok: true, message: `Sent to ${to}.` };
}

/** They looked at it with you on the driveway and said yes. */
export async function recordApprovalInPerson(jobId: string): Promise<ReviewResult> {
  const who = await closer();
  if ("error" in who) return { ok: false, message: who.error! };

  const state = await closeoutInputFor(jobId);
  if (!state) return { ok: false, message: "Couldn't find that job." };
  const verdict = canSendForApproval(state.input);
  if (!verdict.ok) return { ok: false, message: verdict.reason };

  const now = new Date().toISOString();
  const supabase = await createClient();
  const { error } = await supabase.from("job_client_reviews").insert({
    organization_id: state.organizationId,
    job_id: jobId,
    status: "approved",
    sent_at: now,
    responded_at: now,
    sent_by: who.profile.id,
    recorded_by: who.profile.id,
    client_note: "Approved in person.",
  });
  if (error) return { ok: false, message: "Couldn't record that. Try again." };
  refresh(jobId);
  return { ok: true, message: "Recorded. Now approve and sign it off." };
}

/**
 * The last step: the client has approved, so you approve, and the job is
 * signed off in the same tap, with what it really cost: the crew's hours,
 * the materials bought and anything else it took. The project review is
 * scored on those from here on, and the job comes onto it now. Checked
 * against the database, not the screen.
 */
export async function approveAndSignOff(
  jobId: string,
  cost: { crewHours: number; materialsDollars: number; otherDollars: number; note?: string }
): Promise<ReviewResult> {
  const who = await closer();
  if ("error" in who) return { ok: false, message: who.error! };
  const fine = (n: number) => Number.isFinite(n) && n >= 0;
  if (!cost || !fine(cost.crewHours) || !fine(cost.materialsDollars) || !fine(cost.otherDollars)) {
    return { ok: false, message: "Put in what it really cost: the crew's hours, the materials, and anything else (0 if nothing)." };
  }

  const state = await closeoutInputFor(jobId);
  if (!state) return { ok: false, message: "Couldn't find that job." };
  const verdict = canSignOffProject(state.input);
  if (!verdict.ok) return { ok: false, message: verdict.reason };

  const now = new Date().toISOString();
  const supabase = await createClient();
  const { error } = await supabase
    .from("jobs")
    .update({
      photos_approved_at: now,
      photos_approved_by: who.profile.id,
      final_crew_hours: Math.round(cost.crewHours * 100) / 100,
      final_materials_cents: Math.round(cost.materialsDollars * 100),
      final_other_cents: Math.round(cost.otherDollars * 100),
      final_cost_note: cost.note?.trim() || null,
      ...(state.input.jobStatus === "completed" ? {} : { status: "completed", completed_at: now, completed_by: who.profile.id }),
    })
    .eq("id", jobId);
  if (error) return { ok: false, message: "Couldn't sign it off. Try again." };
  refresh(jobId);
  revalidatePath("/pipeline");
  revalidatePath("/jobs/review");
  return { ok: true, message: "Signed off. It's on the project review now." };
}

/**
 * The client's answer, from the link. Only the newest link can be answered:
 * an older one was replaced after a fix, and the photos on it are not the
 * work as it stands.
 */
export async function respondToClientReview(
  token: string,
  decision: "approved" | "changes",
  note: string | null
): Promise<ReviewResult> {
  if (!/^[a-f0-9]{16,64}$/.test(token)) return { ok: false, message: "This link isn't valid." };
  const text = (note ?? "").trim().slice(0, 2000);
  if (decision === "changes" && !text) return { ok: false, message: "Tell us what isn't right, so we can fix it." };

  const admin = createAdminClient();
  const { data: review } = await admin
    .from("job_client_reviews")
    .select("id, job_id, organization_id, status, created_at")
    .eq("token", token)
    .maybeSingle();
  if (!review) return { ok: false, message: "This link isn't valid." };

  const { data: newer } = await admin
    .from("job_client_reviews")
    .select("id")
    .eq("job_id", review.job_id)
    .gt("created_at", review.created_at)
    .limit(1);
  if ((newer ?? []).length > 0) return { ok: false, message: "We sent you a newer version of these photos. Please use the latest link." };
  if (review.status === "approved") return { ok: true, message: "Already approved. Thank you." };

  const { error } = await admin
    .from("job_client_reviews")
    .update({ status: decision, responded_at: new Date().toISOString(), client_note: decision === "changes" ? text : text || null })
    .eq("id", review.id);
  if (error) return { ok: false, message: "Couldn't save that. Please try again." };

  // In the project's conversation, where the team reads what the client says.
  await admin.from("job_messages").insert({
    job_id: review.job_id,
    organization_id: review.organization_id,
    channel: "external",
    author_type: "client",
    author_name: "Client",
    body: decision === "approved" ? `Approved the before and afters.${text ? ` "${text}"` : ""}` : `Asked for changes on the before and afters: "${text}"`,
  });

  revalidatePath(`/jobs/${review.job_id}`);
  return decision === "approved"
    ? { ok: true, message: "Thank you. We have your approval." }
    : { ok: true, message: "Thank you. We will be in touch to put it right." };
}
