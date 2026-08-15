import { createClient } from "@/lib/supabase/server";
import type { JobMessage, MessageChannel } from "@/types/domain";

export async function listJobMessages(jobId: string, channel: MessageChannel): Promise<JobMessage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("job_messages")
    .select("*")
    .eq("job_id", jobId)
    .eq("channel", channel)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as JobMessage[];
}
