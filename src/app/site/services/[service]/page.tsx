import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { JsonLd } from "@/components/website/json-ld";
import { SiteServiceView } from "@/components/website/site-service-view";
import { loadPublicWebsite } from "@/lib/data/website";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { DEFAULT_WEBSITE, isWebsiteHost, serviceBySlug, serviceIntro, serviceJsonLd, serviceTitle, type SiteReview, type WebsiteContent } from "@/lib/website";

/**
 * A service's page across the whole service area: /site/services/mulch-bed-refresh,
 * or /services/mulch-bed-refresh on the business's own domain. The services
 * are the ones in the website editor; one taken out stops having a page.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ service: string }>; searchParams?: Promise<{ org?: string }> };

async function load(props: Props): Promise<{ content: WebsiteContent; orgSlug: string | null; reviews: SiteReview[] }> {
  const { org } = (await props.searchParams) ?? {};
  const slug = org && /^[a-z0-9-]{3,80}$/.test(org) ? org : null;
  if (!isSupabaseAdminConfigured) return { content: DEFAULT_WEBSITE, orgSlug: null, reviews: [] };
  return (await loadPublicWebsite(slug).catch(() => null)) ?? { content: DEFAULT_WEBSITE, orgSlug: null, reviews: [] };
}

async function pageUrl(serviceSlug: string, orgSlug: string | null): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "app.jslandscapingmd.com";
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (isWebsiteHost(host)) return `${proto}://${host}/services/${serviceSlug}`;
  return `${proto}://${host}/site/services/${serviceSlug}${orgSlug ? `?org=${encodeURIComponent(orgSlug)}` : ""}`;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { service: slug } = await props.params;
  const { content, orgSlug } = await load(props);
  const service = serviceBySlug(content, slug);
  if (!service) return { title: content.businessName };
  return {
    title: serviceTitle(service, null, content.businessName),
    description: serviceIntro(service, null, content.businessName).slice(0, 160),
    alternates: { canonical: await pageUrl(slug, orgSlug) },
  };
}

export default async function SiteServicePage(props: Props) {
  const { service: slug } = await props.params;
  const { content, orgSlug, reviews } = await load(props);
  const service = serviceBySlug(content, slug);
  if (!service) notFound();
  return (
    <>
      <JsonLd data={serviceJsonLd(content, await pageUrl(slug, orgSlug), service)} />
      <SiteServiceView content={content} service={service} town={null} orgSlug={orgSlug} reviews={reviews} />
    </>
  );
}
