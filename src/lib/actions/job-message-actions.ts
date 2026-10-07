"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { jobThreadContext } from "@/lib/message-context";
import { clientMessageText, internalNoteText, messageDedupeKey } from "@/lib/message-notify";
import { clientMessageEmail, defaultVia, type MessageVia } from "@/lib/message-via";
import { notifyJobTeam } from "@/lib/notifications";
import { contactsFor, sendClientMessage } from "@/lib/data/client-messaging";
import { getJobCustomerContact } from "@/lib/job-customer";
import { outboundReady } from "@/lib/email/outbound";
import { isSmsConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import type { MessageChannel } from "@/types/domain";

export interface SentMessage {
  via: MessageVia;
  /** Whether it reached them the way that was asked, or only the thread. */
  delivered: boolean;
  /** Why not, in a sentence, when it did not. */
  note: string | null;
}

/**
 * A message on a job's thread, the way the job page sends one.
 *
 * The client-facing channel picks the best way out on its own here: email
 * when it can, a text when it cannot, the page when neither. The inbox lets
 * the person choose instead; that is `sendClientMessageVia` below.
 */
export async function postJobMessage(jobId: string, channel: MessageChannel, body: string): Promise<void> {
  await post(jobId, channel, body, null);
}

/** A message to the client, the way the office chose to send it. */
export async function sendClientMessageVia(jobId: string, body: string, via: MessageVia): Promise<SentMessage> {
  return post(jobId, "external", body, via);
}

async function post(
  jobId: string,
  channel: MessageChannel,
  body: string,
  chosen: MessageVia | null
): Promise<SentMessage> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Write a message first.");

  const organizationId = await getCurrentOrganizationId();
  const authorName = profile.full_name || profile.email;

  // Decided before the row is written, so the thread says how it went from
  // the first render rather than after the provider answers.
  let via: MessageVia | null = null;
  if (channel === "external") {
    via = chosen ?? (await pickVia(jobId, organizationId));
  }

  const supabase = await createClient();
  const { data: saved, error } = await supabase
    .from("job_messages")
    .insert({
      job_id: jobId,
      organization_id: organizationId,
      channel,
      author_type: "team",
      author_profile_id: profile.id,
      author_name: authorName,
      body: trimmed,
      sent_via: via,
    })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  const messageId = (saved as { id: string } | null)?.id ?? null;

  let result: SentMessage = { via: via ?? "app", delivered: via === "app", note: null };
  try {
    if (channel === "external" && via && via !== "app") {
      result = await deliverToClient({ jobId, organizationId, messageId, body: trimmed, via });
      if (!result.delivered && messageId) {
        // The thread must not say "Email" over a message that never went.
        await createAdminClient().from("job_messages").update({ sent_via: "app" }).eq("id", messageId);
      }
    } else if (channel === "internal") {
      await notifyTeam({ jobId, body: trimmed, messageId, authorName, authorProfileId: profile.id });
    }
  } catch (err) {
    // The message is saved. A notification that fails is never a reason to
    // tell the sender their message did not send, but it is a reason to say
    // it did not reach them.
    log.warn("job_message.notify_failed", { jobId, via, error: err instanceof Error ? err.message : String(err) });
    result = { via: via ?? "app", delivered: false, note: "Saved to the thread, but it could not be sent on." };
  }

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/conversations/job/${jobId}`);
  revalidatePath("/conversations");
  return result;
}

/** The best way out when nobody chose one. */
async function pickVia(jobId: string, organizationId: string): Promise<MessageVia> {
  const [contact, email, context] = await Promise.all([
    getJobCustomerContact(jobId),
    outboundReady(organizationId),
    jobThreadContext(jobId),
  ]);
  return defaultVia({
    phone: contact?.phone ?? null,
    email: contact?.email ?? null,
    smsReady: isSmsConfigured,
    emailReady: email.ready,
    clientLink: context?.clientLink ?? null,
  });
}

/**
 * Out through the one door every client message uses, so a STOP, a do not
 * contact flag and a missing provider are all honoured here too, and the
 * send is in the log with the rest.
 *
 * Quiet hours do not apply: a person typing a reply at nine at night meant
 * it to go at nine at night.
 */
async function deliverToClient(input: {
  jobId: string;
  organizationId: string;
  messageId: string | null;
  body: string;
  via: "email" | "sms";
}): Promise<SentMessage> {
  const context = await jobThreadContext(input.jobId);
  const customer = await getJobCustomerContact(input.jobId);
  if (!customer) return { via: input.via, delivered: false, note: "This job has no client on it." };

  const contact = (await contactsFor([customer.customerId])).get(customer.customerId);
  if (!contact) return { via: input.via, delivered: false, note: "This job has no client on it." };

  const businessName = context?.businessName ?? "";
  const composed =
    input.via === "email"
      ? clientMessageEmail({
          businessName,
          clientName: contact.name,
          body: input.body,
          address: context?.jobLabel ?? null,
          link: context?.clientLink ?? null,
        })
      : { subject: "", text: clientMessageText({ businessName, body: input.body, link: context?.clientLink ?? null }) };

  const outcome = await sendClientMessage(
    {
      organizationId: input.organizationId,
      customerId: customer.customerId,
      channel: input.via,
      basis: "service",
      kind: "client_message",
      referenceId: input.jobId,
      dedupeKey: `${messageDedupeKey(input.messageId ?? `${input.jobId}:${Date.now()}`)}:${input.via}`,
      subject: composed.subject,
      body: composed.text,
    },
    contact,
    { startHour: 0, endHour: 24, timeZone: "UTC" }
  );

  if (outcome.sent) return { via: input.via, delivered: true, note: null };
  return {
    via: input.via,
    delivered: false,
    note: `Saved to the thread, but not ${input.via === "email" ? "emailed" : "texted"}: ${outcome.detail}`,
  };
}

/** An internal note is for the rest of the crew on this job, everyone but the person who typed it. */
async function notifyTeam(input: {
  jobId: string;
  body: string;
  messageId: string | null;
  authorName: string;
  authorProfileId: string;
}): Promise<void> {
  const context = await jobThreadContext(input.jobId);
  await notifyJobTeam(
    input.jobId,
    "team_messages",
    internalNoteText({
      authorName: input.authorName,
      jobLabel: context?.jobLabel ?? "",
      body: input.body,
      link: context?.teamLink ?? null,
    }),
    { dedupeKey: input.messageId ? messageDedupeKey(input.messageId) : undefined, except: input.authorProfileId }
  );
}
