import { isGmailConfigured, sendGmail } from "@/lib/email/gmail";
import { textToHtml } from "@/lib/email/plain";
import { sendEmail } from "@/lib/email/send";

/**
 * One door for the business's own mail to clients and team.
 *
 * Resend first, from the verified sending domain with its default sender,
 * which is where every other app email goes. Gmail only when Resend has
 * no verified domain yet and an app password happens to be set. Either
 * way the caller gets an id to thread the next message under.
 */
export interface OutboundInput {
  organizationId: string;
  to: string;
  toName?: string | null;
  subject: string;
  text: string;
  /** For the fallback only: the name on the From line. */
  fromName: string;
  /** The message this one continues, so a client's mail client threads them. */
  inReplyTo?: string | null;
}

export type OutboundResult = { ok: true; id: string; via: "resend" | "gmail" } | { ok: false; message: string };

export async function sendOutbound(input: OutboundInput): Promise<OutboundResult> {
  const viaResend = await sendEmail({
    organizationId: input.organizationId,
    to: input.to,
    subject: input.subject,
    html: textToHtml(input.text),
    text: input.text,
    stream: "transactional",
    inReplyTo: input.inReplyTo ?? null,
  });
  if (viaResend.ok) return { ok: true, id: viaResend.id, via: "resend" };

  if (isGmailConfigured) {
    const viaGmail = await sendGmail({
      to: input.to,
      toName: input.toName,
      subject: input.subject,
      text: input.text,
      fromName: input.fromName,
      inReplyTo: input.inReplyTo ?? null,
    });
    if (viaGmail.ok) return { ok: true, id: viaGmail.messageId, via: "gmail" };
    return { ok: false, message: `${viaResend.message} Gmail: ${viaGmail.message}` };
  }
  return { ok: false, message: viaResend.message };
}

/** Whether anything at all can send: a verified Resend domain with a sender, or Gmail. */
export async function outboundReady(organizationId: string): Promise<{ ready: boolean; why: string }> {
  const probe = await sendEmail({ organizationId, to: [], subject: "", html: "", stream: "transactional" });
  // An empty recipient list is refused last, after the domain and sender checks.
  if (probe.ok || probe.message === "No recipient.") return { ready: true, why: "Resend" };
  if (isGmailConfigured) return { ready: true, why: "Gmail" };
  return { ready: false, why: probe.message };
}
