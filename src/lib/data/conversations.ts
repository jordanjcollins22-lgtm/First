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

  const jobInfoById = new Map(jobs.map((j) => [j.id, { address: j.property.address, customerName: j.property.customer.name }]));

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
    });
  }

  return Array.from(grouped.values()).sort((a, b) => b.lastMessage.created_at.localeCompare(a.lastMessage.created_at));
}
