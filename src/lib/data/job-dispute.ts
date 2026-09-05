import { createAdminClient } from "@/lib/supabase/admin";
import { NO_DISPUTE, inDispute, type DisputeState } from "@/lib/dispute";

/**
 * Whether this job is in dispute, asked from the paths that send things.
 *
 * On the admin client on purpose: the callers are notification paths, some of
 * which run with no signed-in user at all — a webhook, a cron, a client
 * pressing a button on a page they reached from a text message. A freeze that
 * only worked when somebody happened to be logged in would not be a freeze.
 *
 * Fails open on a missing column and closed on nothing else: before the
 * migration runs there are no disputes to respect, but a database that
 * answers with an error is not the same as one that says no.
 */
export async function disputeForJob(jobId: string): Promise<DisputeState> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("jobs")
      .select("dispute_opened_at, dispute_resolved_at, dispute_kind, dispute_reason")
      .eq("id", jobId)
      .maybeSingle();
    if (!data) return NO_DISPUTE;

    return {
      openedAt: data.dispute_opened_at,
      resolvedAt: data.dispute_resolved_at,
      kind: data.dispute_kind,
      reason: data.dispute_reason,
    };
  } catch {
    return NO_DISPUTE;
  }
}

/** The one line every automatic outbound message asks first. */
export async function frozenForClient(jobId: string): Promise<boolean> {
  return inDispute(await disputeForJob(jobId));
}
