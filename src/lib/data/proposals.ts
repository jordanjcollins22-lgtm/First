import { createClient } from "@/lib/supabase/server";
import type { JobProposal } from "@/types/domain";

export async function getProposalForJob(jobId: string): Promise<JobProposal | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("job_proposals").select("*").eq("job_id", jobId).maybeSingle();
  if (error) throw error;
  return (data as unknown as JobProposal) ?? null;
}
