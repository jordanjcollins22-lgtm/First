import Twilio from "twilio";

import { env, isTwilioConfigured } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

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

export async function sendSms(to: string, body: string): Promise<void> {
  if (!isTwilioConfigured) return;
  const client = Twilio(env.twilioAccountSid, env.twilioAuthToken);
  await client.messages.create({ to, from: env.twilioPhoneNumber, body });
}

/** Best-effort: looks up the job's customer phone and texts them. Silently
 * does nothing if Twilio isn't configured, the job has no property/customer,
 * or the customer has no usable phone number — a text is a bonus on top of
 * the in-app message, never a reason to fail saving it. */
export async function notifyCustomerBySms(jobId: string, body: string): Promise<void> {
  if (!isTwilioConfigured) return;

  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("property_id").eq("id", jobId).maybeSingle();
  if (!job) return;

  const { data: property } = await admin.from("properties").select("customer_id").eq("id", job.property_id).maybeSingle();
  if (!property) return;

  const { data: customer } = await admin.from("customers").select("phone").eq("id", property.customer_id).maybeSingle();
  if (!customer?.phone) return;

  const e164 = toE164(customer.phone);
  if (!e164) return;

  await sendSms(e164, body);
}
