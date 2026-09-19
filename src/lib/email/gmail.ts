import nodemailer from "nodemailer";

import { env } from "@/lib/env";

/**
 * Sending from the business's own Gmail.
 *
 * The evaluation emails go out from the real inbox, so a client who hits
 * reply lands in the same thread the office reads, with no new domain to
 * warm up and no provider to verify. Needs a Google app password, which
 * means two-step verification on the account.
 */
export const isGmailConfigured = Boolean(env.gmailUser && env.gmailAppPassword);

export interface GmailInput {
  to: string;
  toName?: string | null;
  subject: string;
  text: string;
  fromName: string;
  replyTo?: string | null;
  /** The Message-ID of the earlier email in the same conversation, so this one threads under it. */
  inReplyTo?: string | null;
}

export type GmailResult = { ok: true; messageId: string } | { ok: false; message: string };

function transport() {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: env.gmailUser, pass: env.gmailAppPassword },
  });
}

export async function sendGmail(input: GmailInput): Promise<GmailResult> {
  if (!isGmailConfigured) return { ok: false, message: "Gmail sending is not set up: GMAIL_USER and GMAIL_APP_PASSWORD are missing." };
  try {
    const info = await transport().sendMail({
      from: { name: input.fromName, address: env.gmailUser },
      to: input.toName ? { name: input.toName, address: input.to } : input.to,
      replyTo: input.replyTo ?? undefined,
      subject: input.subject,
      text: input.text,
      inReplyTo: input.inReplyTo ?? undefined,
      references: input.inReplyTo ?? undefined,
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
