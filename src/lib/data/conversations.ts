import { createClient } from "@/lib/supabase/server";
import { listJobsWithLocation } from "@/lib/data/jobs";
import type { JobMessage, MessageChannel } from "@/types/domain";

export interface ConversationSummary {
  jobId: string;
  propertyAddress: string;
  customerName: string;
  channel: MessageChannel;
  lastMessage: JobMessage;
  messageCount: number;
  /** Whose job this is, so a row can say who is carrying it. */
  assignedToId: string | null;
  assignedToName: string | null;
  /** How far the office has marked this conversation read. Null means never. */
  readThrough: string | null;
  /** Who last marked it read, so "dealt with" has a name against it. */
  readByName: string | null;
}

/** One row per job+channel that has at least one message, most recently
 * active first — so a new client message or internal note surfaces without
 * having to open every job to check. */
export async function listConversations(): Promise<ConversationSummary[]> {
  const supabase = await createClient();
  const [{ data: messages, error }, jobs, reads] = await Promise.all([
    supabase.from("job_messages").select("*").order("created_at", { ascending: false }),
    listJobsWithLocation(),
    listConversationReads(),
  ]);
  if (error) throw error;
  if (!messages || messages.length === 0) return [];

  // Who is carrying each job, so a row can say so and My Inbox can mean
  // something. Names are looked up once rather than per message.
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, email");
  const nameById = new Map(
    ((profiles ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [
      p.id,
      p.full_name || p.email,
    ])
  );

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

  const grouped = new Map<string, ConversationSummary>();
  for (const raw of messages) {
    const message = raw as unknown as JobMessage;
    const key = `${message.job_id}:${message.channel}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.messageCount += 1;
      continue;
    }
    const info = jobInfoById.get(message.job_id);
    const read = reads.get(key);
    grouped.set(key, {
      jobId: message.job_id,
      propertyAddress: info?.address ?? "",
      customerName: info?.customerName ?? "",
      channel: message.channel,
      lastMessage: message,
      messageCount: 1,
      assignedToId: info?.assignedToId ?? null,
      assignedToName: info?.assignedToName ?? null,
      readThrough: read?.readThrough ?? null,
      readByName: read?.readByName ?? null,
    });
  }

  return Array.from(grouped.values()).sort((a, b) => b.lastMessage.created_at.localeCompare(a.lastMessage.created_at));
}

/**
 * How far each conversation has been read, keyed the same way the inbox
 * groups them.
 *
 * Tolerated rather than required: before migration 0132 the table does not
 * exist, and an inbox that refuses to load because nothing has been marked
 * read yet is worse than one that shows everything as outstanding.
 */
async function listConversationReads(): Promise<
  Map<string, { readThrough: string; readByName: string | null }>
> {
  const out = new Map<string, { readThrough: string; readByName: string | null }>();
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("conversation_reads").select("*");
    for (const row of (data ?? []) as unknown as {
      job_id: string;
      channel: string;
      read_through: string;
      read_by_name: string | null;
    }[]) {
      out.set(`${row.job_id}:${row.channel}`, {
        readThrough: row.read_through,
        readByName: row.read_by_name,
      });
    }
  } catch {
    // Nothing read yet, as far as anybody can tell.
  }
  return out;
}
