/**
 * A conversation, arranged the way somebody reads one.
 *
 * Messages come back as a flat list with timestamps. What a person needs is
 * days: a heading saying which day, then what was said on it, so scrolling
 * back through a long thread lands somewhere rather than nowhere.
 *
 * Pure, so the grouping and the wording can be tested without a database and
 * cannot differ between the job page and the inbox.
 */

export interface ThreadMessage {
  id: string;
  body: string;
  createdAt: string;
  /** Us or them. */
  fromClient: boolean;
  authorName: string;
  /** Which way it went out, for the line above the bubble. */
  channel: string;
  /** What the client was writing about, when they said. */
  reference?: string | null;
}

export interface ThreadDay {
  /** YYYY-MM-DD, the key the heading is built from. */
  date: string;
  label: string;
  messages: ThreadMessage[];
}

function dayKey(iso: string): string | null {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at.toISOString().slice(0, 10);
}

/**
 * "Today", "Yesterday", then the date.
 *
 * The two words are worth more than the date they replace: a thread where
 * the last heading reads "Today" tells somebody at a glance that this is
 * live, and one reading a date from March tells them it is not.
 */
export function dayLabel(date: string, now: Date): string {
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);

  if (date === today) return "Today";
  if (date === yesterday) return "Yesterday";

  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The time on a single message. */
export function messageTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * The thread, oldest first, split into days.
 *
 * Oldest first because that is the order it happened, and a thread that
 * opens at the bottom is the one somebody expects.
 */
export function groupByDay(messages: ThreadMessage[], now: Date): ThreadDay[] {
  const byDay = new Map<string, ThreadMessage[]>();

  for (const message of messages) {
    const key = dayKey(message.createdAt);
    // A message with an unreadable timestamp still has to appear somewhere,
    // or it silently vanishes from a conversation somebody is relying on.
    const bucket = key ?? "unknown";
    byDay.set(bucket, [...(byDay.get(bucket) ?? []), message]);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => (a === "unknown" ? -1 : b === "unknown" ? 1 : a.localeCompare(b)))
    .map(([date, list]) => ({
      date,
      label: date === "unknown" ? "Undated" : dayLabel(date, now),
      messages: [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }));
}

/** How a message went out, above the bubble. */
export function channelLabel(channel: string): string {
  if (channel === "internal") return "Team note";
  return "Message";
}

/**
 * Who a client message actually reaches.
 *
 * Said on the composer rather than assumed, because "message the client"
 * means a text to one business and an email to another, and somebody typing
 * should know which before they press send.
 */
export function reachLine(input: {
  channel: string;
  phone: string | null;
  email: string | null;
  smsReady: boolean;
}): string {
  if (input.channel === "internal") return "Only the team sees this.";

  const ways: string[] = [];
  if (input.smsReady && input.phone) ways.push(`text ${input.phone}`);
  if (input.email) ways.push(`email ${input.email}`);

  if (ways.length === 0) {
    return "They will see this on their proposal page. We have no phone or email on file for them.";
  }
  return `Goes to their proposal page and as a ${ways.join(" and a ")}.`;
}
