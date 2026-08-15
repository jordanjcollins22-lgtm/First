import { headers } from "next/headers";

import { getCurrentProfile, listProfiles } from "@/lib/data/team";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { isAffiliate } from "@/lib/data/affiliate";
import { ensureAffiliateSlugs, ensureMyAffiliateSlug, ensureOrganizationSlug } from "@/lib/actions/affiliate-actions";
import type { AffiliateRow } from "@/components/booking/booking-links-panel";

export interface BookingLinksBundle {
  /** Admin-only management data; undefined for everyone else. */
  bookingLinks?: {
    generalLink: string | null;
    affiliates: AffiliateRow[];
    candidates: { id: string; name: string }[];
  };
  /** The viewer's own link, if they're an affiliate. */
  myBookingLink: string | null;
}

/** Everything the Calendar page needs for booking links. Slugs are minted
 * on read so a newly added affiliate always has a link by the time it's
 * displayed. */
export async function getBookingLinksBundle(): Promise<BookingLinksBundle> {
  const profile = await getCurrentProfile();
  if (!profile) return { myBookingLink: null };

  const isAdmin = profile.roles.includes("admin");
  if (isAdmin) {
    await Promise.all([ensureAffiliateSlugs().catch(() => {}), ensureOrganizationSlug().catch(() => {})]);
  } else {
    await ensureMyAffiliateSlug().catch(() => {});
  }

  const headersList = await headers();
  const host = headersList.get("host") ?? "";
  const proto = headersList.get("x-forwarded-proto") ?? "https";
  const baseUrl = host ? `${proto}://${host}` : "";

  const [org, profiles, freshProfile] = await Promise.all([
    getCurrentOrganization(),
    isAdmin ? listProfiles() : Promise.resolve([]),
    getCurrentProfile(),
  ]);

  const myBookingLink = freshProfile?.affiliate_slug ? `${baseUrl}/book?ref=${freshProfile.affiliate_slug}` : null;
  if (!isAdmin) return { myBookingLink };

  const affiliates: AffiliateRow[] = profiles.filter(isAffiliate).map((p) => ({
    id: p.id,
    name: p.full_name || p.email,
    link: p.affiliate_slug ? `${baseUrl}/book?ref=${p.affiliate_slug}` : null,
    // A role-derived affiliate can't be removed here — that's a role change.
    isExplicit: p.is_affiliate,
  }));

  return {
    bookingLinks: {
      generalLink: org.slug ? `${baseUrl}/book?org=${org.slug}` : null,
      affiliates,
      candidates: profiles
        .filter((p) => !isAffiliate(p))
        .map((p) => ({ id: p.id, name: p.full_name || p.email })),
    },
    myBookingLink,
  };
}
