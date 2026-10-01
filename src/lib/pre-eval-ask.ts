import { BUSINESS_TIME_ZONE, dateKeyIn } from "@/lib/time-zone";

/**
 * The email an account manager sends a client who has not filled out the
 * pre-evaluation form: the link, and that otherwise it is the first five to
 * ten minutes of the visit. Pure, so the preview on the button is exactly
 * what is sent.
 */

export interface PreEvalAskInput {
  clientName: string | null;
  address: string;
  /** When the evaluation is booked for. */
  dueAt: string;
  /** First name of whoever is coming out, if anyone is assigned. */
  evaluator: string | null;
  link: string;
  /** The account manager sending it. */
  sender: string | null;
  business: string;
  phone: string | null;
  now: Date;
  timeZone?: string;
}

export function preEvalAskEmail(input: PreEvalAskInput): { subject: string; body: string } {
  const timeZone = input.timeZone ?? BUSINESS_TIME_ZONE;
  const due = new Date(input.dueAt);
  const time = due.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  const today = dateKeyIn(input.now, timeZone);
  const tomorrow = dateKeyIn(new Date(input.now.getTime() + 24 * 60 * 60 * 1000), timeZone);
  const dueDay = dateKeyIn(due, timeZone);
  const when =
    dueDay === today
      ? `today at ${time}`
      : dueDay === tomorrow
        ? `tomorrow at ${time}`
        : `on ${due.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone })} at ${time}`;

  const first = input.clientName?.trim().split(/\s+/)[0] || "there";
  const who = input.evaluator ? `${input.evaluator} is` : "We are";
  const place = input.address.split(",")[0]?.trim() || "your property";
  const sign = [input.sender?.trim(), input.business, input.phone].filter(Boolean).join("\n");

  return {
    subject: "A quick form before your visit",
    body:
      `Hi ${first},\n\n` +
      `${who} coming out to ${place} ${when}. Before then, could you fill out our short pre-evaluation form? ` +
      `It takes about five minutes and tells us what you want done, so we come ready with ideas:\n\n` +
      `${input.link}\n\n` +
      `If you don't get to it, no problem. We'll go through it together in the first five to ten minutes of the appointment.\n\n` +
      `Thank you,\n${sign}`,
  };
}
