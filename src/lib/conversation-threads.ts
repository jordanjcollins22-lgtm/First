/**
 * Turning a window of messages into inbox rows.
 *
 * The inbox is one row per job and channel, showing the last thing said. It
 * used to get there by reading every message row that had ever been written
 * and grouping them in memory, which is a cost that grows every day the
 * business operates in order to render four fields per row.
 *
 * What makes a window enough: messages are read newest first, so any
 * conversation missing from the window has its newest message older than
 * everything in it. The conversations found in a window are therefore exactly
 * the most recently active ones, in the right order — a prefix of the real
 * list rather than a sample of it. That is what lets the inbox page honestly
 * without asking the database for an aggregate it cannot express.
 *
 * The price is the count. A conversation is counted back only as far as the
 * edge of the window, so `messageCount` is a floor. That trade is deliberate
 * and it is written down where the field is declared.
 */

/** How many messages a conversation is assumed to hold, when working out how
 * wide a window has to be to fill a page of them. Low enough that most pages
 * come back in one read, high enough that most do not need a second. */
const MESSAGES_PER_CONVERSATION = 8;

/** The most messages any single inbox read will ever ask for. A hard ceiling
 * rather than a guess: whatever the window arithmetic says, this is the
 * number that has to stay survivable in five years. */
export const MAX_MESSAGE_WINDOW = 5000;

/**
 * The window sizes to try, in order, to fill a page of conversations.
 *
 * Two attempts at most. One busy job — a client and the office going back and
 * forth forty times — can fill a window on its own and leave the inbox
 * showing three rows, so there is a second, wider read for that case. There
 * is no third: past the ceiling the honest answer is a short page and a
 * "there is more" flag, not an unbounded read.
 */
export function messageWindows(pageSize: number, max: number = MAX_MESSAGE_WINDOW): number[] {
  // One more than the page, so the caller can tell a full page from the end
  // of the list without a second query.
  const wanted = pageSize + 1;
  const ceiling = Math.max(max, wanted);
  const first = Math.min(wanted * MESSAGES_PER_CONVERSATION, ceiling);
  return first >= ceiling ? [ceiling] : [first, ceiling];
}

/** What grouping needs from a message, and nothing else — so this stays
 * usable whatever narrow set of columns the query actually selected. */
export interface ThreadMessage {
  job_id: string;
  channel: string;
  created_at: string;
}

export interface Thread<M extends ThreadMessage> {
  /** job and channel, the way the read marks are keyed too. */
  key: string;
  jobId: string;
  channel: string;
  lastMessage: M;
  /** How many of this conversation's messages were in the window. A floor. */
  messageCount: number;
}

/** The key an inbox row, a read mark and a "mark as read" all agree on. */
export function threadKey(jobId: string, channel: string): string {
  return `${jobId}:${channel}`;
}

/**
 * One entry per job and channel, most recently active first.
 *
 * Deliberately does not assume the messages arrive in any order. They do come
 * back newest first today, but a grouping that silently returns the wrong
 * "last message" when a query gains an `order` clause is a bug nobody would
 * think to look for, and comparing timestamps costs nothing.
 */
export function newestPerThread<M extends ThreadMessage>(messages: M[]): Thread<M>[] {
  const byKey = new Map<string, Thread<M>>();

  for (const message of messages) {
    const key = threadKey(message.job_id, message.channel);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        key,
        jobId: message.job_id,
        channel: message.channel,
        lastMessage: message,
        messageCount: 1,
      });
      continue;
    }
    existing.messageCount += 1;
    if (message.created_at > existing.lastMessage.created_at) existing.lastMessage = message;
  }

  // Ties broken on the key so two conversations written in the same second
  // do not swap places between two loads of the same page.
  return [...byKey.values()].sort(
    (a, b) =>
      b.lastMessage.created_at.localeCompare(a.lastMessage.created_at) || a.key.localeCompare(b.key)
  );
}
