import { createClient } from "@/lib/supabase/server";
import { listJobsWithLocation } from "@/lib/data/jobs";
import { messageWindows, newestPerThread, threadKey, type Thread } from "@/lib/conversation-threads";
import { boundedPageSize, takePage } from "@/lib/pagination";
import type { JobMessage, MessageChannel } from "@/types/domain";

/**
 * The part of a message an inbox row draws, and nothing else.
 *
 * Named columns rather than `*` because the inbox renders a name, a preview,
 * a reference line and a timestamp — so the organisation id, the author's
 * profile id and the reference kind were being carried across the wire for
 * every message in the window to be thrown away on arrival.
 */
export type ConversationLastMessage = Pick<
  JobMessage,
  | "id"
  | "job_id"
  | "channel"
  | "author_type"
  | "author_name"
  | "reference_label"
  | "body"
  | "created_at"
>;

const MESSAGE_COLUMNS = "id, job_id, channel, author_type, author_name, reference_label, body, created_at";

/** How many conversations one load of the inbox shows. A phone screen holds
 * about six of these, so fifty is several thumb-flicks past what anybody
 * reads before they either open something or search. */
export const CONVERSATIONS_PAGE_SIZE = 50;

/** The most any one caller can ask for. The page size is in the URL, and a
 * cap is what stops "?show=999999" being a way to ask for the whole table. */
const MAX_CONVERSATIONS_PAGE = 400;

export interface ConversationSummary {
  jobId: string;
  propertyAddress: string;
  customerName: string;
  channel: MessageChannel;
  lastMessage: ConversationLastMessage;
  /**
   * How many messages this conversation has, counted across the window the
   * inbox actually read rather than the whole table.
   *
   * A floor, not a total. A conversation with three hundred messages on it is
   * counted back only as far as the edge of the window, so the number can be
   * low on the very busiest threads. That is the deliberate trade: the exact
   * figure costs a scan of every message ever written, and it is filling in
   * small grey text under a preview line.
   */
  messageCount: number;
  /** Whose job this is, so a row can say who is carrying it. */
  assignedToId: string | null;
  assignedToName: string | null;
  /** How far the office has marked this conversation read. Null means never. */
  readThrough: string | null;
  /** Who last marked it read, so "dealt with" has a name against it. */
  readByName: string | null;
}

export interface ConversationPage {
  conversations: ConversationSummary[];
  /** Whether there are older conversations behind this page. */
  hasMore: boolean;
  /**
   * How many were asked for, after clamping, which is not always how many
   * came back. A "show more" built on the number of rows on screen walks
   * backwards the moment one busy job leaves the page short of its size.
   */
  pageSize: number;
}

/** One row per job+channel that has at least one message, most recently
 * active first — so a new client message or internal note surfaces without
 * having to open every job to check.
 *
 * Bounded. This used to read every message row there had ever been and group
 * them here, which is a page whose cost grows with every message the business
 * sends. It reads a window instead: because messages come back newest first,
 * a conversation missing from the window is older than every conversation in
 * it, so the rows are the real top of the list and not a sample of it. */
export async function listConversations(
  options: { limit?: string | number | null } = {}
): Promise<ConversationPage> {
  const pageSize = boundedPageSize(options.limit, CONVERSATIONS_PAGE_SIZE, MAX_CONVERSATIONS_PAGE);

  const [recent, jobs, reads, nameById] = await Promise.all([
    readRecentThreads(pageSize),
    listJobsWithLocation(),
    listConversationReads(),
    // Who is carrying each job, so a row can say so and My Inbox can mean
    // something. Names are looked up once rather than per message.
    listAssigneeNames(),
  ]);

  const jobInfoById = new Map(
    jobs.map((j) => [
      j.id,
      {
        address: j.property.address,
        customerName: j.property.customer.name,
        assignedToId: j.assigned_to ?? null,
        assignedToName: j.assigned_to ? nameById.get(j.assigned_to) ?? null : null,
      },
    ])
  );

  const { items, hasMore } = takePage(recent.threads, pageSize);

  const conversations = items.map((thread) => {
    const info = jobInfoById.get(thread.jobId);
    const read = reads.get(thread.key);
    return {
      jobId: thread.jobId,
      propertyAddress: info?.address ?? "",
      customerName: info?.customerName ?? "",
      channel: thread.channel as MessageChannel,
      lastMessage: thread.lastMessage,
      messageCount: thread.messageCount,
      assignedToId: info?.assignedToId ?? null,
      assignedToName: info?.assignedToName ?? null,
      readThrough: read?.readThrough ?? null,
      readByName: read?.readByName ?? null,
    };
  });

  // Unread messages past the edge of the window are still conversations
  // somebody can ask for, even when this page did not fill.
  return { conversations, hasMore: hasMore || !recent.exhausted, pageSize };
}

/**
 * The most recently active conversations, read as a bounded window.
 *
 * Widened once and only once. A single job where the client and the office
 * went back and forth forty times can fill a narrow window on its own and
 * leave the inbox showing three rows, which looks like lost messages. Past
 * the second read the honest answer is a short page carrying "there is more",
 * not an unbounded query.
 */
async function readRecentThreads(pageSize: number) {
  const supabase = await createClient();
  let threads: Thread<ConversationLastMessage>[] = [];
  let exhausted = false;

  for (const size of messageWindows(pageSize)) {
    const { data, error } = await supabase
      .from("job_messages")
      .select(MESSAGE_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(size);
    if (error) throw error;

    const rows = (data ?? []) as unknown as ConversationLastMessage[];
    threads = newestPerThread(rows);
    // Fewer rows than asked for means the window reached the beginning of the
    // table, so what is here is every conversation there is.
    exhausted = rows.length < size;
    if (exhausted || threads.length > pageSize) break;
  }

  return { threads, exhausted };
}

/** Team names by profile id. Small and fixed by the size of the business,
 * unlike the messages, so this one is read whole on purpose. */
async function listAssigneeNames(): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name, email");
  return new Map(
    ((data ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [
      p.id,
      p.full_name || p.email,
    ])
  );
}

/**
 * How far each conversation has been read, keyed the same way the inbox
 * groups them.
 *
 * Tolerated rather than required: before migration 0132 the table does not
 * exist, and an inbox that refuses to load because nothing has been marked
 * read yet is worse than one that shows everything as outstanding.
 *
 * Read whole rather than paged. One row per conversation somebody has dealt
 * with is bounded by the conversations themselves, and it is three narrow
 * columns; paging it would mean a page of the inbox could show a row as
 * outstanding when it is not, which is the exact lie this table was added to
 * stop telling.
 */
async function listConversationReads(): Promise<
  Map<string, { readThrough: string; readByName: string | null }>
> {
  const out = new Map<string, { readThrough: string; readByName: string | null }>();
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("conversation_reads")
      .select("job_id, channel, read_through, read_by_name");
    for (const row of (data ?? []) as unknown as {
      job_id: string;
      channel: string;
      read_through: string;
      read_by_name: string | null;
    }[]) {
      out.set(threadKey(row.job_id, row.channel), {
        readThrough: row.read_through,
        readByName: row.read_by_name,
      });
    }
  } catch {
    // Nothing read yet, as far as anybody can tell.
  }
  return out;
}
