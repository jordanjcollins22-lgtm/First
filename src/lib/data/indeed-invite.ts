import type { SupabaseClient } from "@supabase/supabase-js";

import { appUrl } from "@/lib/app-url";
import { outboundBaseUrl } from "@/lib/base-url";
import { sendOutbound } from "@/lib/email/outbound";
import { getReceivedEmail, listReceivedEmails, type ReceivedEmail } from "@/lib/email/resend";
import { applyInvite, applyReminder, isIndeedAddress, readIndeedNotice, relaySender, type IndeedMail } from "@/lib/hiring/indeed-notice";
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
  /** They went on to fill in our application. */
  applied: boolean;
  /** When the one reminder went, if it did. */
  remindedAt: string | null;
}

/** The Indeed applicants written to lately, newest first, for the Hiring page. */
export async function listIndeedInvites(limit = 30): Promise<IndeedInviteRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("indeed_invites")
    .select("id, name, position, status, detail, created_at, applicant_id, reminded_at")
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
    applied: Boolean(r.applicant_id),
    remindedAt: r.reminded_at,
  }));
}

export type IndeedOutcome = "sent" | "no_address" | "repeat" | "failed" | "duplicate" | "gmail_code" | "passed_on";

const PROVIDER_ID = "provider:";

/**
 * A bounce on an email we sent: when it was an applicant's invite, the invite
 * is marked failed and the owner is told who to message on Indeed instead.
 * Returns whether it was one of ours.
 */
export async function noteIndeedBounce(admin: Admin, emailId: string): Promise<boolean> {
  const { data: invite } = await admin
    .from("indeed_invites")
    .select("id, organization_id, name, position")
    .eq("detail", `${PROVIDER_ID}${emailId}`)
    .maybeSingle();
  if (!invite) return false;
  await admin.from("indeed_invites").update({ status: "failed", detail: "Indeed did not accept the email (bounced)." }).eq("id", invite.id);
  const position = positionFor(invite.position);
  const applyUrl = await inviteLink(invite.position, invite.id);
  log.warn("indeed.invite_bounced", { inviteId: invite.id });
  await tellOwners(
    admin,
    invite.organization_id,
    `${invite.name ?? "An applicant"} (${position?.title ?? invite.position}) didn't get our application link: Indeed bounced the email. Message them on Indeed with: ${applyUrl}`,
    `indeed_bounced:${invite.id}`
  );
  return true;
}

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
  if (!isIndeedAddress(from) && !TOOLS_OWNER_EMAILS.includes(from)) return null;
  const notice = readIndeedNotice(mail);
  if (!notice) {
    if (!isIndeedAddress(from)) return null;
    // Anything else Indeed sends here (confirming this address, a team
    // invite, a round-up, an applicant writing back) goes on to the owner,
    // so none of it is lost.
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

  // The link carries this invite, so their application is matched back to it.
  const applyUrl = await inviteLink(position.key, claimed.id);
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

  const { business, sender } = await senderNames(admin, organizationId);
  const { subject, text } = applyInvite({ name: notice.name, positionTitle: position.title, applyUrl, sender, business });

  // From the hiring address: it is the one on the Indeed account, and Indeed
  // only passes on mail to an applicant from the employer's own addresses.
  // Their answers come back to it too, and are passed on to the owner.
  const sent = await sendOutbound({
    organizationId,
    to: notice.relay,
    toName: notice.name ?? undefined,
    subject,
    text,
    fromName: business,
    fromAddress: HIRING_INBOX,
    replyTo: `${HIRING_INBOX}, ${TOOLS_OWNER_EMAILS[0]}`,
  });
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
  // The provider's id is kept so a bounce can find this invite again (noteIndeedBounce).
  await finish("sent", sent.via === "resend" ? `${PROVIDER_ID}${sent.id}` : null);
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
  // An applicant writing back through Indeed (to our invite, say) reads as them, not as Indeed.
  const fromApplicant = Boolean(relaySender(email.from));
  const sent = await sendOutbound({
    organizationId,
    to: TOOLS_OWNER_EMAILS[0],
    subject: fromApplicant ? `Applicant wrote through Indeed: ${email.subject ?? "(no subject)"}` : `Indeed sent the hiring inbox: ${email.subject ?? "(no subject)"}`,
    text: fromApplicant
      ? `An applicant wrote to ${HIRING_INBOX} through Indeed. Answer them on Indeed, or reply to ${relaySender(email.from)}.\n\n----------\n\n${body}`
      : `This came from Indeed to ${HIRING_INBOX}. It isn't an application, so the app passed it on to you.\n\n----------\n\n${body}`,
    fromName: "JS Landscaping app",
  });
  if (!sent.ok) log.warn("indeed.pass_on_failed", { error: sent.message });
}

/**
 * Indeed applications that reached the hiring inbox but were never answered:
 * a webhook that did not arrive, or one the app could not read at the time.
 * Each is handled as if it had just arrived; one already answered is skipped
 * by its email id, so running this often is harmless. Only applications are
 * picked up here, so nothing else is passed on twice.
 */
export async function catchUpIndeedMail(admin: Admin, organizationId?: string, days = 7): Promise<{ checked: number; handled: number; error?: string }> {
  // Without an organisation, the one whose domain the hiring inbox is on.
  const orgId =
    organizationId ??
    (await admin.from("email_domains").select("organization_id").eq("hostname", HIRING_INBOX.split("@")[1]).limit(1).maybeSingle()).data?.organization_id;
  if (!orgId) return { checked: 0, handled: 0, error: "No organisation owns the hiring inbox's domain." };
  const listed = await listReceivedEmails();
  if (!listed.ok) {
    log.warn("indeed.catch_up_unavailable", { error: listed.message });
    return { checked: 0, handled: 0, error: listed.message };
  }
  const since = Date.now() - days * 86_400_000;
  const candidates = listed.data.filter(
    (e) =>
      (e.to ?? []).some((a) => (senderAddress(a) ?? "") === HIRING_INBOX) &&
      Boolean(relaySender(e.from ?? "")) &&
      !/^\s*(re|fwd?|fw)\s*:/i.test(e.subject ?? "") &&
      new Date(e.created_at).getTime() >= since
  );
  if (candidates.length === 0) return { checked: 0, handled: 0 };

  const { data: done } = await admin.from("indeed_invites").select("email_id").in("email_id", candidates.map((e) => e.id));
  const answered = new Set((done ?? []).map((r) => r.email_id));
  let handled = 0;
  for (const listedEmail of candidates.filter((e) => !answered.has(e.id))) {
    const fetched = await getReceivedEmail(listedEmail.id);
    if (!fetched.ok) continue;
    const mail: IndeedMail = { from: fetched.data.from, subject: fetched.data.subject, text: fetched.data.text, html: fetched.data.html, replyTo: fetched.data.reply_to ?? null };
    if (!readIndeedNotice(mail)) continue;
    const outcome = await handleIndeedMail(admin, orgId, listedEmail.id, fetched.data).catch((err) => {
      log.warn("indeed.catch_up_failed", { emailId: listedEmail.id, error: err instanceof Error ? err.message : String(err) });
      return null;
    });
    if (outcome && outcome !== "duplicate") handled += 1;
  }
  if (handled > 0) log.info("indeed.caught_up", { handled });
  return { checked: candidates.length, handled };
}

/** Our application for one job, carrying the invite it was sent with. */
async function inviteLink(positionKey: string, inviteId: string): Promise<string> {
  return appUrl(await outboundBaseUrl(), `/careers/${positionKey}?src=indeed&inv=${inviteId}`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An application, matched back to the Indeed invite that brought it: by the
 * invite the link carried, or, for a link sent before links carried one, by
 * the same name for the same job. Lets the Hiring page show who applied and
 * stops their reminder.
 */
export async function linkIndeedInvite(
  admin: Admin,
  input: { organizationId: string; applicantId: string; position: string; name: string; invite: string | null; source: string | null }
): Promise<void> {
  if (input.invite && UUID.test(input.invite)) {
    const { data } = await admin
      .from("indeed_invites")
      .update({ applicant_id: input.applicantId })
      .eq("id", input.invite)
      .eq("organization_id", input.organizationId)
      .is("applicant_id", null)
      .select("id");
    if ((data ?? []).length > 0) return;
  }
  if (input.source !== "indeed" || input.name.trim().length < 2) return;
  const since = new Date(Date.now() - REPEAT_DAYS * 86_400_000).toISOString();
  const { data: byName } = await admin
    .from("indeed_invites")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("position", input.position)
    .ilike("name", input.name.trim())
    .is("applicant_id", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  const match = (byName ?? [])[0];
  if (match) await admin.from("indeed_invites").update({ applicant_id: input.applicantId }).eq("id", match.id);
}

/** How long after the link before the one reminder, and how long after that nobody is chased. */
const REMIND_AFTER_HOURS = 20;
const STOP_AFTER_DAYS = 7;

/**
 * One reminder, through Indeed, to each applicant sent our link a day or more
 * ago who hasn't filled in the application. Never a second: once reminded,
 * they stay on the Hiring page as waiting, for a call or a message instead.
 */
export async function remindIndeedApplicants(admin: Admin): Promise<{ reminded: number; failed: number }> {
  const before = new Date(Date.now() - REMIND_AFTER_HOURS * 3_600_000).toISOString();
  const after = new Date(Date.now() - STOP_AFTER_DAYS * 86_400_000).toISOString();
  const { data: due } = await admin
    .from("indeed_invites")
    .select("id, organization_id, name, position, relay")
    .eq("status", "sent")
    .is("applicant_id", null)
    .is("reminded_at", null)
    .not("relay", "is", null)
    .lte("created_at", before)
    .gte("created_at", after)
    .limit(50);
  let reminded = 0;
  let failed = 0;
  for (const invite of due ?? []) {
    const position = positionFor(invite.position);
    if (!position || !invite.relay) continue;
    // Claimed first, so two runs at once remind once.
    const { data: claimed } = await admin
      .from("indeed_invites")
      .update({ reminded_at: new Date().toISOString() })
      .eq("id", invite.id)
      .is("reminded_at", null)
      .select("id");
    if ((claimed ?? []).length === 0) continue;

    const { business, sender } = await senderNames(admin, invite.organization_id);
    const { subject, text } = applyReminder({ name: invite.name, positionTitle: position.title, applyUrl: await inviteLink(position.key, invite.id), sender, business });
    const sent = await sendOutbound({
      organizationId: invite.organization_id,
      to: invite.relay,
      toName: invite.name ?? undefined,
      subject,
      text,
      fromName: business,
      fromAddress: HIRING_INBOX,
      replyTo: `${HIRING_INBOX}, ${TOOLS_OWNER_EMAILS[0]}`,
    });
    if (sent.ok) {
      reminded += 1;
      log.info("indeed.reminder_sent", { inviteId: invite.id });
    } else {
      failed += 1;
      log.warn("indeed.reminder_failed", { inviteId: invite.id, error: sent.message });
    }
  }
  return { reminded, failed };
}

/** The business name and the owner's first name, for signing what goes to applicants. */
async function senderNames(admin: Admin, organizationId: string): Promise<{ business: string; sender: string }> {
  const [{ data: org }, { data: owner }] = await Promise.all([
    admin.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
    admin.from("profiles").select("first_name, full_name").eq("organization_id", organizationId).in("email", TOOLS_OWNER_EMAILS).limit(1).maybeSingle(),
  ]);
  const business = (org as { name?: string } | null)?.name ?? "JS Landscaping";
  return { business, sender: owner?.first_name || owner?.full_name?.split(" ")[0] || business };
}
