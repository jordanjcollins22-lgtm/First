/**
 * Whether we are allowed to send this client this message.
 *
 * One decision, in one place, with a reason attached. Every rule here is
 * either the law or the thing that keeps a phone number working, and both are
 * easier to get right once than to remember eleven times.
 *
 * The distinction that matters is why we are writing. A message about work
 * somebody has actually booked -- your crew is coming on Thursday, here is
 * your proposal, this invoice is due -- rides on the relationship: they gave
 * us the number for exactly this. A message about work they have not asked
 * for is marketing, and marketing needs somebody to have said yes.
 *
 * So the same client can be reachable for one and not the other, and the
 * caller has to say which it is rather than the rule guessing. The one thing
 * that overrules everything is somebody telling us to stop.
 */

export type Channel = "sms" | "email";

/**
 * What we know about being allowed to contact somebody on a channel.
 *
 * "unknown" is honest and it is the normal state for a client we have worked
 * for: nobody ever presented them with a tick box, and nobody had to.
 */
export type ConsentState = "unknown" | "granted" | "revoked";

/**
 * Why we are writing.
 *
 * "service" is about work in hand. "marketing" is everything else, and it
 * needs a yes on file.
 */
export type SendBasis = "service" | "marketing";

export interface ConsentInput {
  basis: SendBasis;
  channel: Channel;
  state: ConsentState;
  /** The blanket "leave this person alone" flag on the customer record. */
  doNotContact: boolean;
  /** Whether the provider for this channel is set up at all. */
  providerReady: boolean;
  /** The phone number or email address on file, if there is one. */
  address: string | null | undefined;
}

export type SkipReason =
  | "no_provider"
  | "do_not_contact"
  | "revoked"
  | "no_consent"
  | "no_address";

export type SendVerdict = { send: true } | { send: false; reason: SkipReason; detail: string };

/**
 * The order these are checked in is the order they matter in.
 *
 * Somebody who has said stop is first, above everything, including a message
 * we would otherwise be entitled to send. A client who texts STOP and then
 * gets an appointment reminder anyway has been ignored, and that is worse
 * than a missed reminder however the rule is written.
 */
export function consentVerdict(input: ConsentInput): SendVerdict {
  if (input.state === "revoked") {
    return {
      send: false,
      reason: "revoked",
      detail: `They asked us to stop ${input.channel === "sms" ? "texting" : "emailing"} them.`,
    };
  }
  if (input.doNotContact) {
    return { send: false, reason: "do_not_contact", detail: "This contact is marked do not contact." };
  }
  if (!input.providerReady) {
    return {
      send: false,
      reason: "no_provider",
      detail:
        input.channel === "sms"
          ? "No text provider is set up. Add the Twilio keys and redeploy."
          : "No email provider is set up. Add the Resend key and verify a sending domain.",
    };
  }
  if (!input.address?.trim()) {
    return {
      send: false,
      reason: "no_address",
      detail: input.channel === "sms" ? "No phone number on file." : "No email address on file.",
    };
  }
  if (input.basis === "marketing" && input.state !== "granted") {
    return {
      send: false,
      reason: "no_consent",
      detail: "Nobody has said yes to marketing on this channel, and this message is marketing.",
    };
  }
  return { send: true };
}

/**
 * What a client texting back is asking for.
 *
 * The carriers require STOP and HELP to work on every number, whatever the
 * app thinks. The rest of these are the words people actually send when they
 * mean stop, and every provider treats them the same way, so we do too rather
 * than filing "CANCEL" as a conversation and carrying on texting.
 */
export type InboundIntent = "stop" | "start" | "help" | "message";

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "optout", "revoke"]);
const START_WORDS = new Set(["start", "unstop", "yes", "optin"]);
const HELP_WORDS = new Set(["help", "info"]);

export function inboundIntent(body: string): InboundIntent {
  // The keyword and nothing else, however it was capitalised or punctuated.
  // "Stop by tomorrow" is a sentence about a visit, not an opt-out, and
  // treating it as one loses a client a text they wanted. Two words are
  // allowed only because "stop all" and "opt out" are one keyword written
  // with a space in it.
  const words = body.trim().toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 2) return "message";
  const word = words.join("");

  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  if (HELP_WORDS.has(word)) return "help";
  return "message";
}

/** What a number is told when it opts out. Required, and required to be last. */
export function stopConfirmation(business: string): string {
  return `${business}: you will not get any more texts from us. Reply START to turn them back on.`;
}

/** What a number is told when it asks for help. Also required. */
export function helpReply(business: string, phone: string | null): string {
  const contact = phone ? ` Call us on ${phone}.` : "";
  return `${business}: we send appointment and job updates.${contact} Reply STOP to stop. Message and data rates may apply.`;
}

/** What a number is told when it opts back in. */
export function startConfirmation(business: string): string {
  return `${business}: you are back on. We will text you about your appointments and jobs. Reply STOP to stop.`;
}
