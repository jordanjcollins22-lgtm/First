/**
 * Which channel a one-message-at-a-time sequence uses for one client: a text
 * where a text can go, an email where it can't. sendClientMessage makes the
 * final call on every send; this only avoids trying a channel that is bound
 * to be refused, so the fallback actually gets used. Pure.
 */

import { consentVerdict, type Channel, type ConsentState, type SendBasis } from "@/lib/client-consent";

export interface Reachability {
  phone: string | null;
  email: string | null;
  doNotContact: boolean;
  smsConsent: ConsentState;
  emailConsent: ConsentState;
}

export function canReach(contact: Reachability, channel: Channel, basis: SendBasis, providerReady: boolean): boolean {
  return consentVerdict({
    basis,
    channel,
    state: channel === "sms" ? contact.smsConsent : contact.emailConsent,
    doNotContact: contact.doNotContact,
    providerReady,
    address: channel === "sms" ? contact.phone : contact.email,
  }).send;
}

/** Text first, email as the fallback; nothing when neither can go. */
export function textElseEmail(contact: Reachability, basis: SendBasis, ready: { sms: boolean; email: boolean }): Channel | null {
  if (canReach(contact, "sms", basis, ready.sms)) return "sms";
  if (canReach(contact, "email", basis, ready.email)) return "email";
  return null;
}

/** Every channel that can go, for the campaigns that send on both. */
export function reachableChannels(contact: Reachability, basis: SendBasis, ready: { sms: boolean; email: boolean }): Channel[] {
  return (["email", "sms"] as const).filter((c) => canReach(contact, c, basis, c === "sms" ? ready.sms : ready.email));
}
