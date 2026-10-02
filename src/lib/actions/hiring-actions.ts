"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { listRolePermissions } from "@/lib/data/permissions";
import { tabsAllowedForRoles } from "@/lib/permissions";
import { outboundBaseUrl } from "@/lib/base-url";
import { appUrl } from "@/lib/app-url";
import { sendOutbound } from "@/lib/email/outbound";
import { refuseInDemo } from "@/lib/demo-mode";
import { log, maskEmail } from "@/lib/log";
import { parseAsBusinessTime, shortWhen } from "@/lib/time-zone";
import { positionFor } from "@/lib/hiring/positions";
import { applicantEmail, stageAfter, type ApplicantEmailKind } from "@/lib/hiring/emails";
import { isStage, nextStages, type Stage } from "@/lib/hiring/screening";

/**
 * The reviewer's side of hiring: rate and note, move an application along,
 * and email the applicant. Every email is shown first and goes on Send.
 */

type Result = { ok: true; message?: string } | { ok: false; message: string };

async function reviewer() {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const permissions = await listRolePermissions().catch(() => []);
  if (!tabsAllowedForRoles(profile.roles, permissions).has("hiring")) return null;
  return profile;
}

async function applicantRow(organizationId: string, id: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("job_applicants")
    .select("id, name, email, position, stage, token")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  return data ? { admin, row: data } : null;
}

export async function saveApplicantReview(input: { id: string; rating: number | null; note: string }): Promise<Result> {
  const profile = await reviewer();
  if (!profile) return { ok: false, message: "Only someone with the Hiring tab can review applicants." };
  const found = await applicantRow(profile.organization_id, input.id);
  if (!found) return { ok: false, message: "Couldn't find that applicant." };
  const rating = input.rating != null && input.rating >= 1 && input.rating <= 5 ? Math.round(input.rating) : null;
  const now = new Date().toISOString();
  const { error } = await found.admin
    .from("job_applicants")
    .update({ rating, review_note: input.note.trim().slice(0, 4000) || null, reviewed_by: profile.id, reviewed_at: now, updated_at: now })
    .eq("id", input.id);
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  await found.admin.from("applicant_events").insert({
    applicant_id: input.id,
    kind: "reviewed",
    detail: { rating },
    actor: profile.id,
    actor_name: profile.full_name || null,
  });
  revalidatePath(`/admin/hiring/${input.id}`);
  revalidatePath("/admin/hiring");
  return { ok: true, message: "Saved." };
}

/** Move an application without emailing anyone: marking a hire, or a decision already told in person. */
export async function setApplicantStage(input: { id: string; stage: string }): Promise<Result> {
  const profile = await reviewer();
  if (!profile) return { ok: false, message: "Only someone with the Hiring tab can do that." };
  const found = await applicantRow(profile.organization_id, input.id);
  if (!found) return { ok: false, message: "Couldn't find that applicant." };
  if (!isStage(found.row.stage) || !isStage(input.stage) || !nextStages(found.row.stage).includes(input.stage)) {
    return { ok: false, message: "That isn't a step this application can take from where it is." };
  }
  return moveTo(found.admin, input.id, found.row.stage, input.stage, profile, null);
}

async function moveTo(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  from: Stage,
  to: Stage,
  profile: { id: string; full_name: string | null },
  interviewAt: string | null
): Promise<Result> {
  const now = new Date().toISOString();
  const decided = to === "hired" || to === "not_a_fit" || to === "withdrawn";
  const { error } = await admin
    .from("job_applicants")
    .update({
      stage: to,
      updated_at: now,
      ...(decided ? { decided_at: now } : {}),
      ...(interviewAt ? { interview_at: interviewAt } : {}),
    })
    .eq("id", id);
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  await admin.from("applicant_events").insert({
    applicant_id: id,
    kind: "stage_changed",
    detail: { from, to, interview_at: interviewAt },
    actor: profile.id,
    actor_name: profile.full_name || null,
  });
  revalidatePath(`/admin/hiring/${id}`);
  revalidatePath("/admin/hiring");
  return { ok: true };
}

export type EmailDraft = { ok: true; to: string; subject: string; body: string } | { ok: false; message: string };

function allowedFor(kind: ApplicantEmailKind, stage: Stage): boolean {
  return nextStages(stage).includes(stageAfter(kind));
}

/** The email, word for word, as it would go. Nothing is sent. */
export async function previewApplicantEmail(input: { id: string; kind: ApplicantEmailKind; interviewAt?: string | null; place?: string | null }): Promise<EmailDraft> {
  const profile = await reviewer();
  if (!profile) return { ok: false, message: "Only someone with the Hiring tab can email applicants." };
  const found = await applicantRow(profile.organization_id, input.id);
  if (!found) return { ok: false, message: "Couldn't find that applicant." };
  const { row } = found;
  const position = positionFor(row.position);
  if (!position || !isStage(row.stage)) return { ok: false, message: "That application is for a job we no longer list." };
  if (!allowedFor(input.kind, row.stage)) return { ok: false, message: "That email isn't a step this application can take from where it is." };
  if (input.kind === "interview" && !input.interviewAt) return { ok: false, message: "Pick the interview day and time first." };

  const { data: org } = await found.admin.from("organizations").select("name, business_phone").eq("id", profile.organization_id).maybeSingle();
  const business = (org as { name?: string } | null)?.name ?? "JS Landscaping MD";
  const when = input.interviewAt ? shortWhen(parseAsBusinessTime(input.interviewAt)) : null;
  const { subject, body } = applicantEmail({
    kind: input.kind,
    firstName: row.name.split(/\s+/)[0] ?? row.name,
    positionTitle: position.title,
    business,
    phone: (org as { business_phone?: string | null } | null)?.business_phone ?? null,
    sender: profile.full_name?.trim().split(/\s+/)[0] ?? null,
    when,
    place: input.place?.trim() || null,
    videoUrl: appUrl(await outboundBaseUrl(), `/careers/video/${row.token}`),
  });
  return { ok: true, to: row.email, subject, body };
}

/**
 * Sends the email as it was shown, with any changes made to it, and moves
 * the application to match. Once per press: the stage it moves to is the
 * guard against a double tap sending two.
 */
export async function sendApplicantEmail(input: {
  id: string;
  kind: ApplicantEmailKind;
  subject: string;
  body: string;
  interviewAt?: string | null;
}): Promise<Result> {
  await refuseInDemo();
  const profile = await reviewer();
  if (!profile) return { ok: false, message: "Only someone with the Hiring tab can email applicants." };
  const found = await applicantRow(profile.organization_id, input.id);
  if (!found) return { ok: false, message: "Couldn't find that applicant." };
  const { row, admin } = found;
  if (!isStage(row.stage) || !allowedFor(input.kind, row.stage)) return { ok: false, message: "That's already been done." };
  const subject = input.subject.trim().slice(0, 200);
  const body = input.body.trim().slice(0, 8000);
  if (!subject || !body) return { ok: false, message: "The email is empty." };
  const interviewAt = input.kind === "interview" && input.interviewAt ? parseAsBusinessTime(input.interviewAt).toISOString() : null;
  if (input.kind === "interview" && !interviewAt) return { ok: false, message: "Pick the interview day and time first." };

  // Moved first, so a second press finds it already moved and sends nothing.
  const moved = await moveTo(admin, row.id, row.stage, stageAfter(input.kind), profile, interviewAt);
  if (!moved.ok) return moved;

  const { data: org } = await admin.from("organizations").select("name").eq("id", profile.organization_id).maybeSingle();
  const sent = await sendOutbound({
    organizationId: profile.organization_id,
    to: row.email,
    toName: row.name,
    subject,
    text: body,
    fromName: (org as { name?: string } | null)?.name ?? "JS Landscaping MD",
  });
  if (!sent.ok) {
    // Put it back, so it can be tried again.
    await admin.from("job_applicants").update({ stage: row.stage, updated_at: new Date().toISOString() }).eq("id", row.id);
    await admin.from("applicant_events").insert({
      applicant_id: row.id,
      kind: "stage_changed",
      detail: { from: stageAfter(input.kind), to: row.stage, reason: "email_failed" },
      actor: profile.id,
      actor_name: profile.full_name || null,
    });
    return { ok: false, message: `It didn't send: ${sent.message}` };
  }
  await admin.from("applicant_events").insert({
    applicant_id: row.id,
    kind: "email_sent",
    detail: { kind: input.kind, subject, provider_id: sent.id },
    actor: profile.id,
    actor_name: profile.full_name || null,
  });
  log.info("hiring.email_sent", { applicantId: row.id, kind: input.kind, to: maskEmail(row.email), via: sent.via });
  return { ok: true, message: `Sent to ${row.email}.` };
}
