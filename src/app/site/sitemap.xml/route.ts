import type { NextRequest } from "next/server";

import { loadPublicWebsite } from "@/lib/data/website";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { DEFAULT_WEBSITE, isWebsiteHost, siteUrls, sitemapXml } from "@/lib/website";

/**
 * The website's sitemap: the home page and every town page. Served at
 * /sitemap.xml on the business's own domain (proxy rewrite) and at
 * /site/sitemap.xml on the app's.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const org = request.nextUrl.searchParams.get("org");
  const slug = org && /^[a-z0-9-]{3,80}$/.test(org) ? org : null;
  const site = isSupabaseAdminConfigured ? await loadPublicWebsite(slug).catch(() => null) : null;
  const host = request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host ?? "app.jslandscapingmd.com"}`;
  const urls = siteUrls(origin, isWebsiteHost(host), site?.content ?? DEFAULT_WEBSITE, site?.orgSlug ?? null);
  return new Response(sitemapXml(urls.map((loc) => ({ loc, lastmod: site?.publishedAt ?? null }))), {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
