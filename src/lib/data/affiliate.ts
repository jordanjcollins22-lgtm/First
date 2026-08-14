import { listProfiles } from "@/lib/data/team";
import { qualifiesForAffiliateLink } from "@/lib/affiliate-roles";
import type { Profile } from "@/types/domain";

/** Every evaluator/account manager in the org, for the admin booking-links list. */
export async function listAffiliateProfiles(): Promise<Profile[]> {
  const profiles = await listProfiles();
  return profiles.filter((p) => qualifiesForAffiliateLink(p.roles));
}
