import { createAdminClient } from "@/lib/supabase/admin";
import type { JobMessage } from "@/types/domain";

/**
 * The external (client-visible) thread only — never the internal one — for a
 * job the caller has already identified.
 *
 * Takes the job rather than the token because the page has just loaded the
 * proposal and knows it. Looking the token up again to find a job_id we are
 * already holding is a round trip to learn something we knew, on a page a
 * client is waiting on.
 */
export async function listExternalMessagesForJob(jobId: string): Promise<JobMessage[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("job_messages")
    .select("*")
    .eq("job_id", jobId)
    .eq("channel", "external")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as JobMessage[];
}

/** The same thread, for a caller that has only the token. */
export async function listPublicExternalMessages(token: string): Promise<JobMessage[]> {
  const admin = createAdminClient();
  const { data: proposal, error } = await admin
    .from("job_proposals")
    .select("job_id")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  if (!proposal) return [];

  return listExternalMessagesForJob(proposal.job_id);
}
