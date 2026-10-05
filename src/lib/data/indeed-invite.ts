import type { SupabaseClient } from "@supabase/supabase-js";

import { appUrl } from "@/lib/app-url";
import { outboundBaseUrl } from "@/lib/base-url";
import { sendOutbound } from "@/lib/email/outbound";
import type { ReceivedEmail } from "@/lib/email/resend";
import { applyInvite, readIndeedNotice, type IndeedMail } from "@/lib/hiring/indeed-notice";
import { positionFor } from "@/lib/hiring/positions";
import { htmlToText, senderAddress } from "@/lib/inbound-email";
import { log, maskEmail } from "@/lib/log";
import { notifyTeamMember } from "@/lib/notifications";
import { TOOLS_OWNER_EMAILS } from "@/lib/tool-editors";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type Admin = SupabaseClient<Database>;

/** The address Indeed's application emails go to, so the app can answer them. */
export const HIRING_INBOX = "hiring@send.jslandscapingmd.com";

export interface IndeedInviteRow {
  id: string;
  name: string | null;
  position: string;
  status: "sent" | "no_address" | "repeat" | "failed";
  detail: string | null;
  createdAt: string;
}

/** The Indeed applicants written to lately, newest first, for the Hiring page. */
export async function listIndeedInvites(limit = 30): Promise<IndeedInviteRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("indeed_invites")
    .select("id, name, position, status, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    position: r.position,
    status: r.status as IndeedInviteRow["status"],
    detail: r.status === "failed" ? r.detail : null,
    createdAt: r.created_at,
  }));
}

export type IndeedOutcome = "sent" | "no_address" | "repeat" | "failed" | "duplicate" | "gmail_code" | "passed_on";

/** A person who applied for one of our jobs is written to once a month at most. */
const REPEAT_DAYS = 30;

/**
 * Indeed's "someone applied" email, arriving at the app's hiring address:
 * the applicant is sent our own application link straight away, through the
 * Indeed address that reaches them, in the words the owner approved. The
 * owner asked for this to go without approval.
 *
 * Returns null when the email is not one of these, so it is filed as usual.
 * When Indeed gave no address, the owner is told who applied and the link
 * to send them. Gmail's code for confirming a forwarding address is passed
 * to the owner too, since this is where it lands.
 */
export async function handleIndeedMail(
  admin: Admin,
  organizationId: string,
  emailId: string,
  email: ReceivedEmail & { reply_to?: string | string[] | null }
): Promise<IndeedOutcome | null> {
  const from = senderAddress(email.from) ?? "";

  if (from === "forwarding-noreply@google.com") {
    await tellOwners(admin, organizationId, `Gmail sent the code to confirm forwarding to the app: ${email.subject ?? "(no subject)"}`, `gmail_code:${emailId}`);
    return "gmail_code";
  }

  const mail: IndeedMail = { from: email.from, subject: email.subject, text: email.text, html: email.html, replyTo: email.reply_to ?? null };
  // Forwarded by hand only counts from the owner's own mailbox.
  if (!/indeed\.com$/.test(from) && !TOOLS_OWNER_EMAILS.includes(from)) return null;
  const notice = readIndeedNotice(mail);
  if (!notice) {
    if (!/indeed\.com$/.test(from)) return null;
    // Anything else Indeed sends here (confirming this address, a team
    // invite, a round-up) goes on to the owner, so none of it is lost.
    log.info("indeed.not_an_application", { emailId, subject: (email.subject ?? "").slice(0, 120) });
    await passOn(organizationId, email);
    return "passed_on";
  }
  const position = positionFor(notice.position);
  if (!position) return null;

  // Claimed first, so the same email delivered twice sends once.
  const { data: claimed, error: claimError } = await admin
    .from("indeed_invites")
    .insert({ organization_id: organizationId, email_id: emailId, name: notice.name, position: notice.position, relay: notice.relay, status: "failed", detail: "sending" })
    .select("id")
    .maybeSingle();
  if (claimError || !claimed) return "duplicate";
  const finish = (status: "sent" | "no_address" | "repeat" | "failed", detail: string | null) =>
    admin.from("indeed_invites").update({ status, detail }).eq("id", claimed.id);

  const applyUrl = appUrl(await outboundBaseUrl(), `/careers/${position.key}?src=indeed`);
  const who = notice.name ?? "Someone";

  if (!notice.relay) {
    await finish("no_address", null);
    await tellOwners(
      admin,
      organizationId,
      `${who} applied for ${position.title} on Indeed, but Indeed's email had no address to send our application to. Message them on Indeed with this link: ${applyUrl}`,
      `indeed_no_address:${emailId}`
    );
    return "no_address";
  }

  const since = new Date(Date.now() - REPEAT_DAYS * 86_400_000).toISOString();
  const { data: before } = await admin
    .from("indeed_invites")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("relay", notice.relay)
    .eq("status", "sent")
    .gte("created_at", since)
    .limit(1);
  if ((before ?? []).length > 0) {
    await finish("repeat", `Already sent the link for another job.`);
    return "repeat";
  }

  const [{ data: org }, { data: owner }] = await Promise.all([
    admin.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
    admin.from("profiles").select("first_name, full_name").eq("organization_id", organizationId).in("email", TOOLS_OWNER_EMAILS).limit(1).maybeSingle(),
  ]);
  const business = (org as { name?: string } | null)?.name ?? "JS Landscaping";
  const sender = owner?.first_name || owner?.full_name?.split(" ")[0] || business;
  const { subject, text } = applyInvite({ name: notice.name, positionTitle: position.title, applyUrl, sender, business });

  const sent = await sendOutbound({ organizationId, to: notice.relay, toName: notice.name ?? undefined, subject, text, fromName: business });
  if (!sent.ok) {
    await finish("failed", sent.message.slice(0, 500));
    log.warn("indeed.invite_failed", { emailId, to: maskEmail(notice.relay), error: sent.message });
    await tellOwners(
      admin,
      organizationId,
      `${who} applied for ${position.title} on Indeed, but the email with our application link didn't send. Message them on Indeed with: ${applyUrl}`,
      `indeed_failed:${emailId}`
    );
    return "failed";
  }
  await finish("sent", null);
  log.info("indeed.invite_sent", { emailId, position: position.key, to: maskEmail(notice.relay), via: sent.via });
  return "sent";
}

async function tellOwners(admin: Admin, organizationId: string, body: string, dedupeKey: string): Promise<void> {
  const { data: owners } = await admin.from("profiles").select("id").eq("organization_id", organizationId).in("email", TOOLS_OWNER_EMAILS);
  await Promise.all(
    (owners ?? []).map((owner) => notifyTeamMember(owner.id, "hiring_alert", body, { dedupeKey, overridesKindPreference: true }).catch(() => false))
  );
}

/** An email Indeed sent the app that isn't an application, on to the owner's inbox with its links kept. */
async function passOn(organizationId: string, email: ReceivedEmail): Promise<void> {
  const withLinks = (email.html ?? "").replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
    const words = label.replace(/<[^>]+>/g, "").trim();
    return words ? `${words} (${href})` : href;
  });
  const body = (email.text?.trim() || htmlToText(withLinks)).slice(0, 20000);
  const sent = await sendOutbound({
    organizationId,
    to: TOOLS_OWNER_EMAILS[0],
    subject: `Indeed sent the hiring inbox: ${email.subject ?? "(no subject)"}`,
    text: `This came from Indeed to hiring@send.jslandscapingmd.com. It isn't an application, so the app passed it on to you.\n\n----------\n\n${body}`,
    fromName: "JS Landscaping app",
  });
  if (!sent.ok) log.warn("indeed.pass_on_failed", { error: sent.message });
}
