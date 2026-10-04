import { listProfiles } from "@/lib/data/team";
import { isFieldOnly, qualifiesForAffiliateLink } from "@/lib/affiliate-roles";
import type { Profile } from "@/types/domain";

/** Anyone an admin has made an affiliate, plus anyone who qualifies by role
 * under the original rule — so existing evaluators and account managers keep
 * the link they already have — plus the crew, who meet the neighbors of
 * every job and earn the same 4% on whatever they bring in. */
export function isAffiliate(profile: Profile): boolean {
  return profile.is_affiliate || qualifiesForAffiliateLink(profile.roles) || isFieldOnly(profile.roles);
}

export async function listAffiliateProfiles(): Promise<Profile[]> {
  const profiles = await listProfiles();
  return profiles.filter(isAffiliate);
}
