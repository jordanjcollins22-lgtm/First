import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalizeWebsite, type WebsiteContent } from "@/lib/website";

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
}

// website_settings is newer than the generated types.
const untyped = (c: unknown) => c as SupabaseClient;

export async function loadWebsiteForEditor(organizationId: string): Promise<WebsiteState> {
  const sb = untyped(await createClient());
  const [{ data: org }, site] = await Promise.all([
    sb.from("organizations").select("name, slug").eq("id", organizationId).maybeSingle(),
    sb.from("website_settings").select("content, published_at").eq("organization_id", organizationId).maybeSingle(),
  ]);
  return {
    content: normalizeWebsite(site.data?.content, org?.name),
    orgSlug: org?.slug ?? null,
    publishedAt: site.data?.published_at ?? null,
    ready: !site.error,
  };
}

/** The public site. With no slug it is the home business: the first organisation made, as the booking page does. */
export async function loadPublicWebsite(slug: string | null): Promise<{ content: WebsiteContent; orgSlug: string | null } | null> {
  const admin = untyped(createAdminClient());
  let q = admin.from("organizations").select("id, name, slug");
  q = slug ? q.eq("slug", slug) : q.order("created_at", { ascending: true }).limit(1);
  const { data: org } = await q.maybeSingle();
  if (!org) return null;
  const { data: site } = await admin.from("website_settings").select("content").eq("organization_id", org.id).maybeSingle();
  return { content: normalizeWebsite(site?.content, org.name), orgSlug: org.slug ?? null };
}
