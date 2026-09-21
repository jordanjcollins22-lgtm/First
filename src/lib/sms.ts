import Twilio from "twilio";
import { log, maskPhone } from "@/lib/log";

import { env, isSmsConfigured, isTwilioConfigured } from "@/lib/env";
import { isGhlConfigured, sendSmsMessage, upsertContact } from "@/lib/ghl/client";
import { getJobCustomerContact } from "@/lib/job-customer";
import { frozenForClient } from "@/lib/data/job-dispute";

/** Assumes a US number when given a bare 10-digit phone — good enough for
 * a single-country landscaping business. Returns null if it can't tell. */
export function toE164(phone: string): string | null {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** Last 10 digits, for matching phone numbers stored in different formats
 * ("(555) 123-4567" vs "+15551234567") against each other. */
export function last10Digits(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

export async function sendSms(to: string, body: string, who: { name?: string | null } = {}): Promise<void> {
  if (!isSmsConfigured) return;

  // No Twilio line of our own: the number GoHighLevel holds for us sends
  // it, into the same conversation the office reads there.
  if (!isTwilioConfigured && isGhlConfigured) {
    try {
      const [firstName, ...rest] = (who.name ?? "").trim().split(/\s+/).filter(Boolean);
      const contactId = await upsertContact({ firstName: firstName || "Client", lastName: rest.join(" "), email: null, phone: to, address: null });
      const id = await sendSmsMessage(contactId, body);
      log.info("sms.sent", { to: maskPhone(to), via: "ghl", id, length: body.length });
      return;
    } catch (err) {
      log.error("sms.failed", err, { to: maskPhone(to), via: "ghl" });
      throw err;
    }
  }

  const client = Twilio(env.twilioAccountSid, env.twilioAuthToken);
  try {
    const sent = await client.messages.create({ to, from: env.twilioPhoneNumber, body });
    log.info("sms.sent", { to: maskPhone(to), sid: sent.sid, length: body.length });
  } catch (err) {
    log.error("sms.failed", err, { to: maskPhone(to) });
    throw err;
  }
}

/** Best-effort: looks up the job's customer phone and texts them. Silently
 * does nothing if Twilio isn't configured, the job has no property/customer,
 * or the customer has no usable phone number — a text is a bonus on top of
 * the in-app message, never a reason to fail saving it. */
export async function notifyCustomerBySms(jobId: string, body: string): Promise<void> {
  if (!isSmsConfigured) {
    // Said out loud. This returning quietly is why a client never heard
    // anything and nothing anywhere explained it.
    console.warn(
      `No text sent to the client on job ${jobId}: no text provider is set up. ` +
        "Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER, then redeploy."
    );
    return;
  }

  // Nothing automatic goes to a client in dispute. A booking confirmation or
  // a proposal update landing in the inbox of somebody talking to a lawyer is
  // the kind of thing that gets read out later. Anything the office types by
  // hand still goes — this stops the machine talking, not the business.
  if (await frozenForClient(jobId)) return;

  const contact = await getJobCustomerContact(jobId);
  if (!contact?.phone) return;

  const e164 = toE164(contact.phone);
  if (!e164) return;

  await sendSms(e164, body, { name: contact.customerName });
}
