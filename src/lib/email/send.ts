import { createAdminClient } from "@/lib/supabase/admin";
import { log, maskEmail } from "@/lib/log";
import { sendProviderEmail } from "@/lib/email/resend";
import { ensureSendingReady } from "@/lib/email/ready";
import type { MailStream } from "@/lib/sending-domains";

export type SendResult = { ok: true; id: string } | { ok: false; message: string };

export interface SendInput {
  organizationId: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /**
   * Which reputation this send spends. Transactional is a proposal or an
   * invoice — mail somebody asked for. Marketing is everything sent to a list.
   */
  stream: MailStream;
  /**
   * The id of the message this one continues. Sent as In-Reply-To and
   * References so the client's mail app shows the sequence as one thread.
   */
  inReplyTo?: string | null;
}

/**
 * Send one email as the business.
 *
 * Picks the address from the verified domain for that stream, and refuses if
 * there isn't one. It never falls back to the other stream's domain: sending
 * a campaign from the invoice subdomain because the marketing one was not
 * ready is precisely the outcome the whole split exists to prevent, and it
 * would happen silently at exactly the moment somebody was in a hurry.
 *
 * Runs on the service-role client, because the callers are webhooks and cron
 * jobs where nobody is signed in.
 */
export async function sendEmail(input: SendInput, attempt = 0): Promise<SendResult> {
  const admin = createAdminClient();

  const { data: domain } = await admin
    .from("email_domains")
    .select("id, hostname, status")
    .eq("organization_id", input.organizationId)
    .eq("stream", input.stream)
    .eq("status", "verified")
    .maybeSingle();

  // No verified domain, or a domain with no address: get it ready and try
  // once more, so a domain whose DNS landed last week starts sending today.
  if (!domain && attempt === 0 && (await ensureSendingReady(input.organizationId, input.stream))) {
    return sendEmail(input, 1);
  }

  if (!domain) {
    return {
      ok: false,
      message:
        input.stream === "marketing"
          ? "No verified marketing domain. Set one up under Settings → Email before sending campaigns."
          : "No verified sending domain. Set one up under Settings → Email.",
    };
  }

  const { data: sender } = await admin
    .from("email_senders")
    .select("address, display_name, reply_to")
    .eq("domain_id", domain.id)
    .eq("is_default", true)
    .maybeSingle();

  if (!sender && attempt === 0 && (await ensureSendingReady(input.organizationId, input.stream))) {
    return sendEmail(input, 1);
  }
  if (!sender) {
    return {
      ok: false,
      message: `${domain.hostname} is verified but has no address to send from yet.`,
    };
  }

  const to = Array.isArray(input.to) ? input.to : [input.to];
  if (to.length === 0) return { ok: false, message: "No recipient." };

  const result = await sendProviderEmail({
    // A display name makes the difference between mail that reads as a person
    // and mail that reads as a robot, in the one line a recipient scans.
    from: sender.display_name ? `${sender.display_name} <${sender.address}>` : sender.address,
    to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    headers: input.inReplyTo ? { "In-Reply-To": asMessageId(input.inReplyTo), References: asMessageId(input.inReplyTo) } : undefined,
    // Replies go to a mailbox somebody reads. The sending subdomain exists to
    // protect reputation, not to be somewhere anybody looks.
    replyTo: sender.reply_to,
  });

  if (!result.ok) {
    log.error("email.failed", undefined, { organizationId: input.organizationId, stream: input.stream, to: to.map(maskEmail), message: result.message });
  }
  return result.ok ? { ok: true, id: result.data.id } : result;
}

/** A bare id becomes a Message-ID; one already in angle brackets is left alone. */
function asMessageId(id: string): string {
  return id.startsWith("<") ? id : `<${id}>`;
}
