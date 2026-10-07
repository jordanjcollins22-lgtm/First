import type { SupabaseClient } from "@supabase/supabase-js";

import { handleIndeedMail, type IndeedOutcome } from "@/lib/data/indeed-invite";
import { jobFor } from "@/lib/data/thread-email";
import { getReceivedEmail } from "@/lib/email/resend";
import { domainOf, looksForged, replyText, senderAddress } from "@/lib/inbound-email";
import { log, maskEmail } from "@/lib/log";
import { stopCompany } from "@/lib/data/pm-sender";
import { notifyTeamMember } from "@/lib/notifications";
import { TOOLS_OWNER_EMAILS } from "@/lib/tool-editors";
import type { Database } from "@/lib/supabase/database.types";

type Admin = SupabaseClient<Database>;

export type InboundOutcome =
  | "filed"
  | "duplicate"
  | "unknown_domain"
  | "unknown_sender"
  | "no_job"
  | "forged"
  | "unreadable"
  | `indeed_${IndeedOutcome}`;

/**
 * A client's emailed reply, into their conversation.
 *
 * The provider says an email arrived at one of our receiving addresses; this
 * fetches it, works out whose business it was sent to from the address's
 * domain, finds the client by the address it came from, and files what they
 * wrote on their most recent job, as a message from them. It then reads as
 * waiting for a reply in Conversations, like any other client message.
 *
 * Nobody is notified from here. Mail from somebody who is not a client, or
 * that fails the receiving server's checks, is left out and logged.
 */
export async function fileInboundEmail(admin: Admin, emailId: string): Promise<InboundOutcome> {
  const fetched = await getReceivedEmail(emailId);
  if (!fetched.ok) {
    log.warn("inbound_email.unreadable", { emailId, error: fetched.message });
    return "unreadable";
  }
  const email = fetched.data;

  const recipients = (email.to ?? []).map((a) => senderAddress(a)).filter((a): a is string => Boolean(a));
  const { data: domains } = await admin
    .from("email_domains")
    .select("organization_id, hostname")
    .in("hostname", [...new Set(recipients.map(domainOf))]);
  const organizationId = (domains ?? [])[0]?.organization_id ?? null;
  if (!organizationId) {
    log.info("inbound_email.unknown_domain", { emailId });
    return "unknown_domain";
  }

  if (looksForged(email.authentication)) {
    log.warn("inbound_email.forged", { emailId });
    return "forged";
  }

  const from = senderAddress(email.from);
  if (!from) return "unknown_sender";

  // Indeed telling us somebody applied: they are sent our application link.
  const indeed = await handleIndeedMail(admin, organizationId, emailId, email).catch((err) => {
    log.warn("inbound_email.indeed_failed", { emailId, error: err instanceof Error ? err.message : String(err) });
    return null;
  });
  if (indeed) return `indeed_${indeed}`;

  // A property manager answering a cold email: their sequence stops and the
  // owner hears about it. Then filed like any other email if they are also a client.
  await notePmReply(admin, organizationId, from, replyText(email.text, email.html)).catch((err) =>
    log.warn("inbound_email.pm_reply_failed", { error: err instanceof Error ? err.message : String(err) })
  );
  const { data: customers } = await admin
    .from("customers")
    .select("id, name")
    .eq("organization_id", organizationId)
    .ilike("email", from)
    .order("created_at", { ascending: false })
    .limit(5);
  const customer = (customers ?? [])[0];
  if (!customer) {
    log.info("inbound_email.unknown_sender", { emailId, from: maskEmail(from) });
    return "unknown_sender";
  }

  const jobId = await jobFor(admin, organizationId, null, customer.id);
  if (!jobId) {
    log.info("inbound_email.no_job", { emailId, customerId: customer.id });
    return "no_job";
  }

  const body = replyText(email.text, email.html).slice(0, 20000);
  const sentAt = email.created_at || new Date().toISOString();
  // The provider can deliver the same event twice; the same reply at the same moment is filed once.
  const { data: already } = await admin
    .from("job_messages")
    .select("id")
    .eq("job_id", jobId)
    .eq("author_type", "client")
    .eq("created_at", sentAt)
    .limit(1);
  if ((already ?? []).length > 0) return "duplicate";

  const subject = (email.subject ?? "").replace(/^\s*(re|fwd?):\s*/i, "").trim();
  const { error } = await admin.from("job_messages").insert({
    job_id: jobId,
    organization_id: organizationId,
    channel: "external",
    author_type: "client",
    author_name: customer.name || from,
    body: body || "(No text in the email.)",
    reference_label: subject || null,
    reference_kind: "email",
    sent_via: "email",
    created_at: sentAt,
  });
  if (error) {
    log.warn("inbound_email.not_filed", { emailId, error: error.message });
    return "unreadable";
  }
  log.info("inbound_email.filed", { emailId, jobId });
  return "filed";
}

/**
 * Whether the sender is a property management company we have been
 * writing to: the same address, or the same company domain when it is not a
 * free mailbox. Their sequence stops and the owner is told.
 */
async function notePmReply(admin: Admin, organizationId: string, from: string, text: string): Promise<void> {
  const domain = domainOf(from);
  const free = /^(gmail|yahoo|aol|hotmail|outlook|icloud|comcast|verizon|live|msn)\./i.test(domain);
  const { data: companies } = await admin
    .from("pm_companies")
    .select("id, name, email, status")
    .eq("organization_id", organizationId)
    .or(free ? `email.ilike.${from}` : `email.ilike.${from},email.ilike.%@${domain}`)
    .limit(1);
  const company = (companies ?? [])[0];
  if (!company) return;
  if (["unsubscribed", "do_not_contact"].includes(company.status)) return;
  await stopCompany(admin, company.id, "replied");
  await admin
    .from("pm_companies")
    .update({ replied_at: new Date().toISOString(), last_reply: text.slice(0, 4000) })
    .eq("id", company.id);
  const { data: owners } = await admin.from("profiles").select("id").eq("organization_id", organizationId).in("email", TOOLS_OWNER_EMAILS);
  const preview = text.replace(/\s+/g, " ").trim().slice(0, 160);
  await Promise.all(
    (owners ?? []).map((owner) =>
      notifyTeamMember(owner.id, "pm_reply", `${company.name} replied to your email: "${preview}" Open Marketing > Property managers.`, {
        dedupeKey: `pm_reply:${company.id}:${preview.slice(0, 40)}`,
        overridesKindPreference: true,
      }).catch(() => false)
    )
  );
}
