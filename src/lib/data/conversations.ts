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
}

/** One row per job+channel that has at least one message, most recently
 * active first — so a new client message or internal note surfaces without
 * having to open every job to check. */
export async function listConversations(): Promise<ConversationSummary[]> {
  const supabase = await createClient();
  const [{ data: messages, error }, jobs] = await Promise.all([
    supabase.from("job_messages").select("*").order("created_at", { ascending: false }),
    listJobsWithLocation(),
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
    grouped.set(key, {
      jobId: message.job_id,
      propertyAddress: info?.address ?? "",
      customerName: info?.customerName ?? "",
      channel: message.channel,
      lastMessage: message,
      messageCount: 1,
      assignedToId: info?.assignedToId ?? null,
      assignedToName: info?.assignedToName ?? null,
    });
  }

  return Array.from(grouped.values()).sort((a, b) => b.lastMessage.created_at.localeCompare(a.lastMessage.created_at));
}
