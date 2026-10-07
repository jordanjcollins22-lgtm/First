import { notFound } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { careersOrg, DEFAULT_HIRING_ORG } from "@/lib/data/hiring";
import { positionFor } from "@/lib/hiring/positions";
import { PositionView } from "@/components/hiring/position-view";

/**
 * One job: what it is, then the questions. The link in its Indeed ad comes
 * here, with ?src=indeed so we know where the applicant came from.
 */
export const dynamic = "force-dynamic";

export default async function PositionPage({
  params,
  searchParams,
}: {
  params: Promise<{ position: string }>;
  searchParams?: Promise<{ org?: string; src?: string; inv?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { position: key } = await params;
  const { org: orgParam, src, inv } = (await searchParams) ?? {};
  const position = positionFor(key);
  const org = await careersOrg(orgParam);
  if (!position || !org) notFound();
  return <PositionView position={position} orgName={org.name} keep={{ org: org.id === DEFAULT_HIRING_ORG ? null : org.id, src: src ?? null, inv: inv ?? null }} />;
}
