import type { NextRequest } from "next/server";

import { isWebsiteHost, robotsTxt } from "@/lib/website";

/**
 * robots.txt for the website. On the business's own domain it is the root's
 * (/robots.txt, by the proxy rewrite) and lets everything be read; it points
 * at the sitemap so the town pages are found.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const host = request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host ?? "app.jslandscapingmd.com"}`;
  const sitemap = isWebsiteHost(host) ? `${origin}/sitemap.xml` : `${origin}/site/sitemap.xml`;
  return new Response(robotsTxt(sitemap), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
