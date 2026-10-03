import type { SupabaseClient } from "@supabase/supabase-js";

import { jobFor } from "@/lib/data/thread-email";
import { getReceivedEmail } from "@/lib/email/resend";
import { domainOf, looksForged, replyText, senderAddress } from "@/lib/inbound-email";
import { log, maskEmail } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";

type Admin = SupabaseClient<Database>;

export type InboundOutcome = "filed" | "duplicate" | "unknown_domain" | "unknown_sender" | "no_job" | "forged" | "unreadable";

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
