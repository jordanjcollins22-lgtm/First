import { createAdminClient } from "@/lib/supabase/admin";
import type { JobMessage } from "@/types/domain";

/** The external (client-visible) thread only — never the internal one — for
 * a given proposal token. */
export async function listPublicExternalMessages(token: string): Promise<JobMessage[]> {
  const admin = createAdminClient();
  const { data: proposal, error } = await admin.from("job_proposals").select("job_id").eq("token", token).maybeSingle();
  if (error) throw error;
  if (!proposal) return [];

  const { data, error: messagesError } = await admin
    .from("job_messages")
    .select("*")
    .eq("job_id", proposal.job_id)
    .eq("channel", "external")
    .order("created_at", { ascending: true });
  if (messagesError) throw messagesError;
  return (data ?? []) as unknown as JobMessage[];
}
