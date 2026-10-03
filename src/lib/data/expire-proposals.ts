import type { SupabaseClient } from "@supabase/supabase-js";

import { EXPIRED_REASON } from "@/lib/proposal-validity";
import { log } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Close every sent proposal whose time has run out.
 *
 * Once a morning, across every business. The proposal is declined the way
 * the office declines one, with what it said before kept, and the job is
 * marked declined with the reason, so the board, the call list and My Day
 * all stop showing it in the same breath and the client's page says why.
 */
export async function expireProposals(admin: SupabaseClient<Database>, now = new Date()): Promise<number> {
  const { data, error } = await admin
    .from("job_proposals")
    .select("id, job_id, expires_at")
    .eq("status", "sent")
    .lt("expires_at", now.toISOString())
    .limit(200);
  if (error) {
    log.error("proposals.expire.read", error);
    return 0;
  }

  let closed = 0;
  for (const proposal of data ?? []) {
    const at = proposal.expires_at ?? now.toISOString();
    const { error: closeError } = await admin
      .from("job_proposals")
      .update({ status: "declined", responded_at: at, office_declined_from: "sent", updated_at: now.toISOString() })
      .eq("id", proposal.id)
      .eq("status", "sent");
    if (closeError) {
      log.error("proposals.expire.close", closeError, { proposalId: proposal.id });
      continue;
    }
    await admin
      .from("jobs")
      .update({ declined_at: at, declined_reason: EXPIRED_REASON })
      .eq("id", proposal.job_id)
      .is("declined_at", null);
    closed += 1;
  }
  if (closed > 0) log.info("proposals.expired", { closed });
  return closed;
}
