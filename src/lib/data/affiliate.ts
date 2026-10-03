import { listProfiles } from "@/lib/data/team";
import { qualifiesForAffiliateLink } from "@/lib/affiliate-roles";
import type { Profile } from "@/types/domain";

/** Anyone an admin has made an affiliate, plus anyone who qualifies by role
 * under the original rule — so existing evaluators and account managers keep
 * the link they already have. */
export function isAffiliate(profile: Profile): boolean {
  return profile.is_affiliate || qualifiesForAffiliateLink(profile.roles);
}

export async function listAffiliateProfiles(): Promise<Profile[]> {
  const profiles = await listProfiles();
  return profiles.filter(isAffiliate);
}
