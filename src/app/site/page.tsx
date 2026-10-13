import type { Metadata } from "next";
import { headers } from "next/headers";

import { JsonLd } from "@/components/website/json-ld";
import { SiteView } from "@/components/website/site-view";
import { loadPublicWebsite } from "@/lib/data/website";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { DEFAULT_WEBSITE, isWebsiteHost, localBusinessJsonLd, normalizeWebsite, type SiteReview, type WebsiteContent } from "@/lib/website";

/**
 * The website, as published from Marketing › Website in the new layout.
 * ?org= is whose business it is; without it, the home business.
 */
export const dynamic = "force-dynamic";

type Props = { searchParams?: Promise<{ org?: string }> };

function slugFrom(org: string | undefined) {
  return org && /^[a-z0-9-]{3,80}$/.test(org) ? org : null;
}

async function load(props: Props): Promise<{ content: WebsiteContent; orgSlug: string | null; reviews: SiteReview[] }> {
  const { org } = (await props.searchParams) ?? {};
  if (!isSupabaseAdminConfigured) return { content: DEFAULT_WEBSITE, orgSlug: null, reviews: [] };
  return (await loadPublicWebsite(slugFrom(org)).catch(() => null)) ?? { content: normalizeWebsite(null), orgSlug: null, reviews: [] };
}

/** The address this page is being read at, for the canonical link and the schema. */
async function pageUrl(orgSlug: string | null): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "app.jslandscapingmd.com";
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (isWebsiteHost(host)) return `${proto}://${host}/`;
  return `${proto}://${host}/site${orgSlug ? `?org=${encodeURIComponent(orgSlug)}` : ""}`;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { content, orgSlug } = await load(props);
  return {
    title: content.businessName,
    description: content.heroSub || content.heroHeadline,
    alternates: { canonical: await pageUrl(orgSlug) },
  };
}

export default async function SitePage(props: Props) {
  const { content, orgSlug, reviews } = await load(props);
  return (
    <>
      <JsonLd data={localBusinessJsonLd(content, await pageUrl(orgSlug))} />
      <SiteView content={content} orgSlug={orgSlug} reviews={reviews} />
    </>
  );
}
