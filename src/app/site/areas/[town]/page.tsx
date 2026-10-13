import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { JsonLd } from "@/components/website/json-ld";
import { SiteAreaView } from "@/components/website/site-area-view";
import { loadPublicWebsite } from "@/lib/data/website";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { areaBySlug, DEFAULT_WEBSITE, defaultAreaIntro, isWebsiteHost, localBusinessJsonLd, type SiteReview, type WebsiteContent } from "@/lib/website";

/**
 * A town's page on the published website: /site/areas/bel-air, or
 * /areas/bel-air on the business's own domain. The towns are the ones in
 * the website editor; a town taken out of the list stops having a page.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ town: string }>; searchParams?: Promise<{ org?: string }> };

async function load(props: Props): Promise<{ content: WebsiteContent; orgSlug: string | null; reviews: SiteReview[] }> {
  const { org } = (await props.searchParams) ?? {};
  const slug = org && /^[a-z0-9-]{3,80}$/.test(org) ? org : null;
  if (!isSupabaseAdminConfigured) return { content: DEFAULT_WEBSITE, orgSlug: null, reviews: [] };
  return (await loadPublicWebsite(slug).catch(() => null)) ?? { content: DEFAULT_WEBSITE, orgSlug: null, reviews: [] };
}

async function pageUrl(townSlug: string, orgSlug: string | null): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "app.jslandscapingmd.com";
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (isWebsiteHost(host)) return `${proto}://${host}/areas/${townSlug}`;
  return `${proto}://${host}/site/areas/${townSlug}${orgSlug ? `?org=${encodeURIComponent(orgSlug)}` : ""}`;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { town } = await props.params;
  const { content, orgSlug } = await load(props);
  const area = areaBySlug(content, town);
  if (!area) return { title: content.businessName };
  return {
    title: `Lawn care & landscaping in ${area.town}, MD · ${content.businessName}`,
    description: (area.intro.trim() || defaultAreaIntro(area.town, content.businessName)).slice(0, 160),
    alternates: { canonical: await pageUrl(town, orgSlug) },
  };
}

export default async function SiteAreaPage(props: Props) {
  const { town } = await props.params;
  const { content, orgSlug, reviews } = await load(props);
  const area = areaBySlug(content, town);
  if (!area) notFound();
  return (
    <>
      <JsonLd data={localBusinessJsonLd(content, await pageUrl(town, orgSlug), area.town)} />
      <SiteAreaView content={content} area={area} orgSlug={orgSlug} reviews={reviews} />
    </>
  );
}
