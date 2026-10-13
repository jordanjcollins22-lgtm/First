import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getIntegration } from "@/lib/integrations/store";
import { normalizeWebsite, type SiteReview, type WebsiteContent } from "@/lib/website";

/**
 * The website's content, for the editor (signed in, read under RLS) and for
 * the public page (no account, read with the service key by the business's
 * slug). A missing row, or the table not having been created yet, reads as
 * the defaults: the site always renders.
 */

export interface WebsiteState {
  content: WebsiteContent;
  orgSlug: string | null;
  publishedAt: string | null;
  /** False until the website_settings table exists; saving needs it. */
  ready: boolean;
  /** Google reviews the site shows, when the Business Profile is connected. Empty otherwise. */
  reviews: SiteReview[];
}

// website_settings is newer than the generated types.
const untyped = (c: unknown) => c as SupabaseClient;

export async function loadWebsiteForEditor(organizationId: string): Promise<WebsiteState> {
  const sb = untyped(await createClient());
  const [{ data: org }, site, reviews] = await Promise.all([
    sb.from("organizations").select("name, slug").eq("id", organizationId).maybeSingle(),
    sb.from("website_settings").select("content, published_at").eq("organization_id", organizationId).maybeSingle(),
    siteReviews(organizationId),
  ]);
  return {
    content: normalizeWebsite(site.data?.content, org?.name),
    orgSlug: org?.slug ?? null,
    publishedAt: site.data?.published_at ?? null,
    ready: !site.error,
    reviews,
  };
}

/** The public site. With no slug it is the home business: the first organisation made, as the booking page does. */
export async function loadPublicWebsite(
  slug: string | null
): Promise<{ content: WebsiteContent; orgSlug: string | null; reviews: SiteReview[]; publishedAt: string | null } | null> {
  const admin = untyped(createAdminClient());
  let q = admin.from("organizations").select("id, name, slug");
  q = slug ? q.eq("slug", slug) : q.order("created_at", { ascending: true }).limit(1);
  const { data: org } = await q.maybeSingle();
  if (!org) return null;
  const [{ data: site }, reviews] = await Promise.all([
    admin.from("website_settings").select("content, published_at").eq("organization_id", org.id).maybeSingle(),
    siteReviews(org.id),
  ]);
  const content = normalizeWebsite(site?.content, org.name);
  return { content, orgSlug: org.slug ?? null, reviews: content.showReviews ? reviews : [], publishedAt: site?.published_at ?? null };
}

/**
 * The live Google reviews for the site: four and five stars with something
 * written, newest first, read from what the daily Business Profile pull
 * stored. Only while the Business Profile is connected, so a disconnected
 * listing never leaves stale reviews on the page. Never throws.
 */
export async function siteReviews(organizationId: string, limit = 6): Promise<SiteReview[]> {
  try {
    const gbp = await getIntegration(organizationId, "google_business");
    if (!gbp || gbp.status !== "connected") return [];
    const admin = untyped(createAdminClient());
    const { data } = await admin
      .from("google_reviews")
      .select("author, stars, body, reviewed_at")
      .eq("organization_id", organizationId)
      .gte("stars", 4)
      .not("body", "is", null)
      .order("reviewed_at", { ascending: false })
      .limit(limit * 2);
    return ((data ?? []) as { author: string | null; stars: number; body: string | null; reviewed_at: string | null }[])
      .filter((r) => (r.body ?? "").trim().length >= 20)
      .slice(0, limit)
      .map((r) => {
        const [first, last] = (r.author ?? "").trim().split(/\s+/);
        return {
          author: first ? `${first}${last ? ` ${last[0]}.` : ""}` : "Google reviewer",
          stars: r.stars,
          body: (r.body ?? "").trim(),
          writtenOn: r.reviewed_at,
        };
      });
  } catch {
    return [];
  }
}
