import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { JsonLd } from "@/components/website/json-ld";
import { SiteServiceView } from "@/components/website/site-service-view";
import { loadPublicWebsite } from "@/lib/data/website";
import { isSupabaseAdminConfigured } from "@/lib/env";
import {
  areaBySlug,
  DEFAULT_WEBSITE,
  isWebsiteHost,
  serviceBySlug,
  serviceIntro,
  serviceJsonLd,
  serviceTitle,
  type SiteReview,
  type WebsiteContent,
} from "@/lib/website";

/**
 * One service in one town: /site/areas/bel-air/lawn-mowing, or
 * /areas/bel-air/lawn-mowing on the business's own domain. Every town in the
 * website editor times every service there, so a search for "<service>
 * <town>" has a page that answers it.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ town: string; service: string }>; searchParams?: Promise<{ org?: string }> };

async function load(props: Props): Promise<{ content: WebsiteContent; orgSlug: string | null; reviews: SiteReview[] }> {
  const { org } = (await props.searchParams) ?? {};
  const slug = org && /^[a-z0-9-]{3,80}$/.test(org) ? org : null;
  if (!isSupabaseAdminConfigured) return { content: DEFAULT_WEBSITE, orgSlug: null, reviews: [] };
  return (await loadPublicWebsite(slug).catch(() => null)) ?? { content: DEFAULT_WEBSITE, orgSlug: null, reviews: [] };
}

async function pageUrl(townSlug: string, serviceSlug: string, orgSlug: string | null): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "app.jslandscapingmd.com";
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (isWebsiteHost(host)) return `${proto}://${host}/areas/${townSlug}/${serviceSlug}`;
  return `${proto}://${host}/site/areas/${townSlug}/${serviceSlug}${orgSlug ? `?org=${encodeURIComponent(orgSlug)}` : ""}`;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { town, service: slug } = await props.params;
  const { content, orgSlug } = await load(props);
  const area = areaBySlug(content, town);
  const service = serviceBySlug(content, slug);
  if (!area || !service) return { title: content.businessName };
  return {
    title: serviceTitle(service, area.town, content.businessName),
    description: serviceIntro(service, area.town, content.businessName).slice(0, 160),
    alternates: { canonical: await pageUrl(town, slug, orgSlug) },
  };
}

export default async function SiteAreaServicePage(props: Props) {
  const { town, service: slug } = await props.params;
  const { content, orgSlug, reviews } = await load(props);
  const area = areaBySlug(content, town);
  const service = serviceBySlug(content, slug);
  if (!area || !service) notFound();
  return (
    <>
      <JsonLd data={serviceJsonLd(content, await pageUrl(town, slug, orgSlug), service, area.town)} />
      <SiteServiceView content={content} service={service} town={area.town} orgSlug={orgSlug} reviews={reviews} />
    </>
  );
}
