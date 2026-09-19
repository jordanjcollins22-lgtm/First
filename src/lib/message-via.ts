/**
 * How a message to a client goes out, and what to tell them about writing back.
 *
 * "Message the client" used to mean one thing decided by the server: a text if
 * a text line was connected, otherwise nothing but a line on their proposal
 * page. The office needs to choose. A price question gets an email they can
 * forward; a "we're running late" gets a text; a note they will read next time
 * they open the proposal goes nowhere else.
 *
 * The other half is the way back. The business's phone number is a phone, not
 * an inbox: a text sent to it lands on one handset and never reaches this
 * thread. So every email and every page the client sees says the same thing,
 * in the same words, and the office composer says it too.
 *
 * Nothing here sends. It decides and it words.
 */

export type MessageVia = "app" | "email" | "sms";

export const VIA_LABEL: Record<MessageVia, string> = {
  app: "App",
  email: "Email",
  sms: "Text",
};

/** What each one is, above a bubble in the thread. */
export function viaBubbleLabel(via: MessageVia | null | undefined): string {
  if (via === "email") return "Email";
  if (via === "sms") return "Text";
  return "App message";
}

export interface ViaFacts {
  phone: string | null;
  email: string | null;
  /** A text line is connected. */
  smsReady: boolean;
  /** A sending domain is verified and has an address on it. */
  emailReady: boolean;
  /** Somewhere the client can read the thread: a proposal is out. */
  clientLink: string | null;
}

export interface ViaOption {
  via: MessageVia;
  label: string;
  available: boolean;
  /** Why it is greyed out, when it is. */
  reason: string | null;
}

/**
 * The three ways, each with whether it can be used right now and why not.
 *
 * Always all three, always in the same order, so the switch never jumps under
 * a thumb. Greyed with a reason beats hidden: "Text: no text line connected"
 * is the sentence that gets Twilio set up.
 */
export function viaOptions(facts: ViaFacts): ViaOption[] {
  return [
    { via: "app", label: VIA_LABEL.app, available: true, reason: null },
    {
      via: "email",
      label: VIA_LABEL.email,
      available: facts.emailReady && Boolean(facts.email?.trim()),
      reason: !facts.emailReady
        ? "Email is not connected yet."
        : !facts.email?.trim()
          ? "No email address on file."
          : null,
    },
    {
      via: "sms",
      label: VIA_LABEL.sms,
      available: facts.smsReady && Boolean(facts.phone?.trim()),
      reason: !facts.smsReady
        ? "No text line is connected."
        : !facts.phone?.trim()
          ? "No phone number on file."
          : null,
    },
  ];
}

/**
 * The way the composer starts on.
 *
 * Email first: it carries the whole message, it can be forwarded to a spouse,
 * and the reply lands where the business reads. A text is second because it
 * is trimmed and because the way back from it is not this thread unless a
 * text line is connected. The app is what is left.
 */
export function defaultVia(facts: ViaFacts): MessageVia {
  const options = viaOptions(facts);
  const email = options.find((o) => o.via === "email");
  if (email?.available) return "email";
  const sms = options.find((o) => o.via === "sms");
  if (sms?.available) return "sms";
  return "app";
}

/** The one sentence about writing back, said everywhere a client reads us. */
export const HOW_TO_REPLY =
  "To reach us, message us from your project page or reply by email. Please do not text our phone number: those messages do not reach the team.";

/** The same fact, for the person typing at the office. */
export const HOW_THEY_REPLY =
  "Clients write back from their project page or by email. A text to the office phone does not land here.";

/**
 * What the office sees under the box, for the way they picked.
 *
 * Says where it goes and whether they will know it arrived. An app message
 * with no proposal out is the important case: it is saved, and nobody will
 * ever see it, and the sentence has to say so before the send.
 */
export function viaReachLine(via: MessageVia, facts: ViaFacts): string {
  if (via === "email") {
    return `Emails ${facts.email ?? "them"}. They can reply to it or from their project page.`;
  }
  if (via === "sms") {
    return `Texts ${facts.phone ?? "them"}. Long messages are cut short.`;
  }
  if (!facts.clientLink) {
    return "Saved to this thread only. No proposal is out yet, so they have no page to read it on.";
  }
  return "Shows on their project page only. They are not told it is there.";
}

/** The email a client gets when the office writes to them. */
export function clientMessageEmail(input: {
  businessName: string;
  clientName: string | null;
  body: string;
  /** The property, so the subject says which job. */
  address: string | null;
  /** Their project page, when there is one. */
  link: string | null;
}): { subject: string; text: string } {
  const business = input.businessName.trim() || "Your crew";
  const first = (input.clientName ?? "").trim().split(/\s+/)[0] ?? "";
  const where = input.address?.trim() ? ` about ${input.address.trim()}` : "";
  const subject = `A message from ${business}${where}`;

  const lines = [first ? `Hi ${first},` : "Hi,", input.body.trim()];
  if (input.link) lines.push(`Your project page: ${input.link}`);
  lines.push(HOW_TO_REPLY, business);
  return { subject, text: lines.join("\n\n") };
}
