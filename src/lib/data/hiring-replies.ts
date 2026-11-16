import type { SupabaseClient } from "@supabase/supabase-js";

import { sendOutbound } from "@/lib/email/outbound";
import { isAcceptance, welcomeEmail } from "@/lib/hiring/emails";
import { positionFor } from "@/lib/hiring/positions";
import { onApplicantHired } from "@/lib/data/onboarding";
import { tellOwner } from "@/lib/data/back-office-owners";
import { log, maskEmail } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";

type Admin = SupabaseClient<Database>;

export type ApplicantReplyOutcome = "accepted" | "noted";

/**
 * An applicant answering their offer by email. "I accept" marks them hired,
 * starts their new-hire checklist and sends the welcome, with nobody pressing
 * anything. Any other reply from somebody with an open offer is logged on
 * their application and the owner is told, so a question never sits unread.
 * Returns null when the sender has no open offer, so the email is filed as
 * usual.
 */
export async function handleApplicantReply(admin: Admin, organizationId: string, from: string, text: string): Promise<ApplicantReplyOutcome | null> {
  const { data: rows } = await admin
    .from("job_applicants")
    .select("id, name, email, position, stage")
    .eq("organization_id", organizationId)
    .eq("stage", "offer_sent")
    .ilike("email", from)
    .order("updated_at", { ascending: false })
    .limit(1);
  const applicant = (rows ?? [])[0];
  if (!applicant) return null;

  const preview = text.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!isAcceptance(text)) {
    await admin.from("applicant_events").insert({ applicant_id: applicant.id, kind: "offer_reply", detail: { text: preview }, actor: null, actor_name: applicant.name });
    await tellOwner(organizationId, `${applicant.name} replied to their offer but didn't say "I accept": "${preview.slice(0, 160)}" Open Hiring to answer.`, `offer_reply:${applicant.id}:${preview.slice(0, 40)}`);
    return "noted";
  }

  // Moved only from offer_sent, so a second copy of the same email does nothing.
  const now = new Date().toISOString();
  const { data: moved } = await admin
    .from("job_applicants")
    .update({ stage: "hired", decided_at: now, updated_at: now })
    .eq("id", applicant.id)
    .eq("stage", "offer_sent")
    .select("id");
  if (!moved || moved.length === 0) return "accepted";

  await admin.from("applicant_events").insert({
    applicant_id: applicant.id,
    kind: "stage_changed",
    detail: { from: "offer_sent", to: "hired", reason: "accepted_by_email" },
    actor: null,
    actor_name: applicant.name,
  });
  await onApplicantHired(organizationId, applicant.id);

  const position = positionFor(applicant.position);
  const { data: org } = await admin.from("organizations").select("name, business_phone").eq("id", organizationId).maybeSingle();
  const business = (org as { name?: string } | null)?.name ?? "JS Landscaping MD";
  const { subject, body } = welcomeEmail({
    firstName: applicant.name.split(/\s+/)[0] ?? applicant.name,
    positionTitle: position?.title ?? "team member",
    positionKey: position?.key ?? null,
    business,
    phone: (org as { business_phone?: string | null } | null)?.business_phone ?? null,
    sender: null,
  });
  const sent = await sendOutbound({ organizationId, to: applicant.email, toName: applicant.name, subject, text: body, fromName: business });
  await admin.from("applicant_events").insert({
    applicant_id: applicant.id,
    kind: sent.ok ? "email_sent" : "email_failed",
    detail: sent.ok ? { kind: "welcome", subject, body, provider_id: sent.id } : { kind: "welcome", error: sent.message },
    actor: null,
    actor_name: "Automatic",
  });
  await tellOwner(
    organizationId,
    `${applicant.name} accepted the ${position?.title ?? ""} offer.${sent.ok ? " Their welcome email went out." : " Their welcome email didn't send, so reach out to them."} Pick their start date in Hiring.`,
    `offer_accepted:${applicant.id}`
  );
  log.info("hiring.offer_accepted", { applicantId: applicant.id, to: maskEmail(applicant.email), welcome: sent.ok });
  return "accepted";
}
