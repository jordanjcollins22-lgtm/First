/**
 * What each reminder actually says.
 *
 * Short, specific, and signed. A reminder that does not say who it is from is
 * a reminder somebody reports as spam, and a reminder that does not say how to
 * stop is one the carriers eventually stop delivering.
 *
 * The footers are not decoration and they are not optional. A text has to
 * carry the business's name and, on the first message to a number, how to opt
 * out. An email has to carry a way to unsubscribe. Both are added here rather
 * than left to whoever writes the next template.
 */

import type { Channel } from "@/lib/client-consent";
import type { ReminderKind } from "@/lib/client-reminders";

export interface MessageFacts {
  businessName: string;
  clientName: string | null;
  /** When the thing happens, already written the way a person says it. */
  when?: string | null;
  /** Where the client goes to do something about it. */
  link?: string | null;
  /** The property, when saying which one helps. */
  address?: string | null;
  amount?: string | null;
}

export interface ComposedMessage {
  /** Empty for a text. */
  subject: string;
  body: string;
}

const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";

/** The body of each reminder, before anything is added to it. */
function core(kind: ReminderKind, facts: MessageFacts): { subject: string; lines: string[] } {
  const hi = firstName(facts.clientName) ? `Hi ${firstName(facts.clientName)}, ` : "";
  const place = facts.address ? ` at ${facts.address}` : "";
  const when = facts.when ? ` for ${facts.when}` : "";

  switch (kind) {
    case "evaluation_confirmed":
      return {
        subject: `Your evaluation is booked${facts.when ? ` for ${facts.when}` : ""}`,
        lines: [
          `${hi}your free evaluation${place} is booked${when}.`,
          "We will walk the property and put together what we would recommend. You do not need to be home, but it helps if you are.",
        ],
      };
    case "evaluation_reminder":
      return {
        subject: `Reminder: we are coming out ${facts.when ?? "soon"}`,
        lines: [
          `${hi}a reminder that we are coming out${place}${when}.`,
          "If that no longer works, reply and we will move it.",
        ],
      };
    case "proposal_follow_up":
      return {
        subject: "Any questions about your proposal?",
        lines: [
          `${hi}we sent your proposal${place} and have not heard back yet.`,
          "No rush, and no pressure. If anything on it needs changing or is out of budget, tell us and we will rework it.",
        ],
      };
    case "job_start_reminder":
      return {
        subject: `We are starting ${facts.when ?? "soon"}`,
        lines: [
          `${hi}we are starting work${place}${when}.`,
          "If you can leave gates unlocked and pets inside that morning, it saves us knocking.",
        ],
      };
    case "invoice_reminder":
      return {
        subject: `Your invoice${facts.amount ? ` for ${facts.amount}` : ""}`,
        lines: [
          `${hi}your invoice${facts.amount ? ` for ${facts.amount}` : ""}${place} is still open.`,
          "If it has been paid already, ignore this and tell us so we can fix our end.",
        ],
      };
  }
}

/**
 * One reminder, ready to send.
 *
 * A text gets the business's name in front and the way out at the end. An
 * email gets a subject and the unsubscribe line, because an email without one
 * is the thing that gets a sending domain blocked.
 */
export function composeReminder(
  kind: ReminderKind,
  channel: Channel,
  facts: MessageFacts,
  options: { includeOptOut?: boolean; unsubscribeUrl?: string | null } = {}
): ComposedMessage {
  const { subject, lines } = core(kind, facts);
  const body = [...lines];
  if (facts.link) body.push(facts.link);

  if (channel === "sms") {
    const text = [`${facts.businessName}: ${body[0]}`, ...body.slice(1)].join(" ");
    return {
      subject: "",
      body: options.includeOptOut ? `${text} Reply STOP to stop.` : text,
    };
  }

  const foot = options.unsubscribeUrl
    ? ["", `${facts.businessName}`, `Not want these reminders? ${options.unsubscribeUrl}`]
    : ["", `${facts.businessName}`];
  return { subject, body: [...body, ...foot].join("\n\n") };
}

/**
 * A text kept inside one message.
 *
 * A text over 160 characters is sent as several and billed as several, and
 * one that runs to four parts arrives out of order on some handsets. So the
 * body is trimmed to fit around whatever the footer costs, on a sentence
 * boundary where there is one.
 */
export const SMS_LIMIT = 320;

export function fitSms(text: string, limit = SMS_LIMIT): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (lastStop > limit * 0.5) return cut.slice(0, lastStop + 1);
  return `${cut.slice(0, limit - 1).trimEnd()}…`;
}

/** How a moment reads in a message, in the client's own words. */
export function sayWhen(at: Date, timeZone: string, now: Date): string {
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(at);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" })
    .format(at)
    .replace(":00", "")
    .toLowerCase()
    .replace(/\s/g, "");
  const date = new Intl.DateTimeFormat("en-US", { timeZone, month: "long", day: "numeric" }).format(at);

  const dayOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(d);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (dayOf(at) === dayOf(now)) return `today at ${time}`;
  if (dayOf(at) === dayOf(tomorrow)) return `tomorrow at ${time}`;

  const daysAway = (new Date(dayOf(at)).getTime() - new Date(dayOf(now)).getTime()) / (24 * 60 * 60 * 1000);
  if (daysAway > 0 && daysAway < 7) return `${day} at ${time}`;
  return `${day} ${date} at ${time}`;
}
