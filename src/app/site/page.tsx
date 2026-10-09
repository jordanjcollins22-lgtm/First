import type { Metadata } from "next";

import { SiteView } from "@/components/website/site-view";
import { loadPublicWebsite } from "@/lib/data/website";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { DEFAULT_WEBSITE, normalizeWebsite } from "@/lib/website";

/**
 * The website, as published from Marketing › Website in the new layout.
 * ?org= is whose business it is; without it, the home business.
 */
export const dynamic = "force-dynamic";

type Props = { searchParams?: Promise<{ org?: string }> };

function slugFrom(org: string | undefined) {
  return org && /^[a-z0-9-]{3,80}$/.test(org) ? org : null;
}

async function load(props: Props) {
  const { org } = (await props.searchParams) ?? {};
  if (!isSupabaseAdminConfigured) return { content: DEFAULT_WEBSITE, orgSlug: null };
  return (await loadPublicWebsite(slugFrom(org)).catch(() => null)) ?? { content: normalizeWebsite(null), orgSlug: null };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { content } = await load(props);
  return { title: content.businessName, description: content.heroSub || content.heroHeadline };
}

export default async function SitePage(props: Props) {
  const { content, orgSlug } = await load(props);
  return <SiteView content={content} orgSlug={orgSlug} />;
}
