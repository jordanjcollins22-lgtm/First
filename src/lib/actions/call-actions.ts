"use server";

import Twilio from "twilio";

import { getCurrentProfile } from "@/lib/data/team";
import { getJobCustomerContact } from "@/lib/job-customer";
import { toE164 } from "@/lib/sms";
import { env, isTwilioConfigured } from "@/lib/env";
import { postJobMessage } from "@/lib/actions/job-message-actions";
import { refuseInDemo } from "@/lib/demo-mode";
import { outboundBaseUrl } from "@/lib/base-url";

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Click-to-call: rings the caller's own phone first, and once they pick up,
 * bridges them straight to the client — no browser mic/softphone needed,
 * works from whatever phone the team member is actually carrying.
 */
export async function startCall(jobId: string): Promise<void> {
  if (!isTwilioConfigured) throw new Error("Calling isn't set up yet.");
  // A demo rings nobody (lib/demo-guard.ts).
  await refuseInDemo();

  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");
  if (!profile.phone) throw new Error("Add your phone number on the Team page before making calls.");
  const myNumber = toE164(profile.phone);
  if (!myNumber) throw new Error("Your phone number on file doesn't look valid.");

  const contact = await getJobCustomerContact(jobId);
  if (!contact?.phone) throw new Error("This client doesn't have a phone number on file.");
  const clientNumber = toE164(contact.phone);
  if (!clientNumber) throw new Error("The client's phone number on file doesn't look valid.");

  // How the call ended goes to dial-status, which logs "no answer" on the
  // proposal by itself and holds an answered call for a one-tap outcome.
  // Absolute, because an inline TwiML has no address to resolve against.
  const base = await outboundBaseUrl().catch(() => "");
  const action = base
    ? ` action="${escapeXml(`${base}/api/webhooks/twilio-voice/dial-status?dir=out&job=${encodeURIComponent(jobId)}&p=${encodeURIComponent(profile.id)}`)}" method="POST"`
    : "";
  const client = Twilio(env.twilioAccountSid, env.twilioAuthToken);
  await client.calls.create({
    to: myNumber,
    from: env.twilioPhoneNumber,
    twiml: `<Response><Say>Connecting you to ${escapeXml(contact.customerName)}.</Say><Dial callerId="${env.twilioPhoneNumber}"${action}>${clientNumber}</Dial></Response>`,
  });

  await postJobMessage(jobId, "internal", `Called ${contact.customerName} (${contact.phone}).`);
}
