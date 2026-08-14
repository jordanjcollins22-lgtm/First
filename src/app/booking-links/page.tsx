import { headers } from "next/headers";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { listAffiliateProfiles } from "@/lib/data/affiliate";
import { ensureAffiliateSlugs, ensureMyAffiliateSlug, ensureOrganizationSlug } from "@/lib/actions/affiliate-actions";
import { qualifiesForAffiliateLink } from "@/lib/affiliate-roles";
import { BookingLinksList } from "@/components/booking/booking-links-list";

export default async function BookingLinksPage() {
  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-muted-foreground">Supabase is not configured yet.</p>
      </div>
    );
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-muted-foreground">Sign in to see your booking links.</p>
      </div>
    );
  }

  const isAdmin = profile.roles.includes("admin");
  const iAmQualified = qualifiesForAffiliateLink(profile.roles);

  if (isAdmin) {
    await Promise.all([ensureAffiliateSlugs(), ensureOrganizationSlug()]);
  } else if (iAmQualified) {
    await ensureMyAffiliateSlug();
  }

  const [org, affiliateProfiles, freshProfile] = await Promise.all([
    getCurrentOrganization(),
    isAdmin ? listAffiliateProfiles() : Promise.resolve([]),
    getCurrentProfile(),
  ]);

  const headersList = await headers();
  const host = headersList.get("host") ?? "";
  const proto = headersList.get("x-forwarded-proto") ?? "https";
  const baseUrl = host ? `${proto}://${host}` : "";

  const adLink = org.slug ? `${baseUrl}/book?org=${org.slug}` : null;
  const myLink = freshProfile?.affiliate_slug ? `${baseUrl}/book?ref=${freshProfile.affiliate_slug}` : null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Booking Links</h1>
      <p className="mb-6 text-muted-foreground">
        Share these so clients can book an evaluation straight into the real schedule.
      </p>

      <BookingLinksList
        adLink={adLink}
        myLink={myLink}
        iAmQualified={iAmQualified}
        isAdmin={isAdmin}
        affiliateProfiles={affiliateProfiles.map((p) => ({
          id: p.id,
          name: p.full_name || p.email,
          link: p.affiliate_slug ? `${baseUrl}/book?ref=${p.affiliate_slug}` : null,
        }))}
      />
    </div>
  );
}
