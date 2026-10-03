import { notFound } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { careersOrg, DEFAULT_HIRING_ORG } from "@/lib/data/hiring";
import { CareersList } from "@/components/hiring/careers-list";

/** Every open job, for somebody who arrived without a particular one in mind. */
export const dynamic = "force-dynamic";

export default async function CareersPage({ searchParams }: { searchParams?: Promise<{ org?: string; src?: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { org: orgParam, src } = (await searchParams) ?? {};
  const org = await careersOrg(orgParam);
  if (!org) notFound();
  return <CareersList orgName={org.name} keep={{ org: org.id === DEFAULT_HIRING_ORG ? null : org.id, src: src ?? null }} />;
}
