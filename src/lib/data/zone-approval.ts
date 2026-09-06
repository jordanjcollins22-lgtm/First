import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { approvalPolicy, approvalStreak, approvedShape, trustLevel, type TrustLevel, type ZoneApprovalRow, type ZoneReview } from "@/lib/zone-approval";

export interface ZoneApprovalState {
  zones: ZoneApprovalRow[];
  reviews: ZoneReview[];
  streak: number;
  level: TrustLevel;
  /** Zones the app approved on this read, because they looked like approved ones. */
  autoApproved: number;
}

/**
 * Every zone's approval, the decisions so far, and the app's own pass:
 * with enough trust, zones that look like approved ones are approved
 * here and now, each with the reason recorded.
 */
export async function zoneApprovalState(): Promise<ZoneApprovalState> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  const { data, error } = await supabase.rpc("zone_approvals", { org });
  if (error) throw error;
  const raw = (data ?? {}) as { zones?: ZoneApprovalRow[]; reviews?: ZoneReview[] };
  const zones = raw.zones ?? [];
  const reviews = raw.reviews ?? [];
  const streak = approvalStreak(reviews);
  const level = trustLevel(streak);
  let autoApproved = 0;
  if (level !== "ask_all") {
    const shape = approvedShape(reviews);
    for (const zone of zones) {
      if (!zone.needsApproval || zone.approval === "rejected") continue;
      const policy = approvalPolicy(zone, shape, level);
      if (policy.decision !== "auto") continue;
      const { error: reviewError } = await supabase.rpc("zone_review", { org, the_zone: zone.id, decision: "auto", reason: policy.why });
      if (reviewError) {
        console.error("[zones] could not approve on the app's behalf:", reviewError.message);
        continue;
      }
      zone.approval = "auto";
      zone.needsApproval = false;
      zone.approvedAt = new Date().toISOString();
      autoApproved++;
    }
  }
  return { zones, reviews, streak, level, autoApproved };
}
