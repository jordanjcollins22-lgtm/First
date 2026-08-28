import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { checkTabAccess } from "@/lib/data/access";
import { listFlyerAds } from "@/lib/data/flyer";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { FlyerBuilder } from "@/components/marketing/flyer-builder";
import { listFlyerBusinesses } from "@/lib/data/flyer-outreach";
import { FlyerOutreachList } from "@/components/flyer/outreach-list";
import { listFlyerRuns } from "@/lib/data/flyer-runs";
import { FlyerRunManager } from "@/components/flyer/run-manager";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { outboundBaseUrl } from "@/lib/base-url";
import { isStripeConfigured } from "@/lib/env";

export default async function FlyerPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { allowed } = await checkTabAccess("flyer");
  if (!allowed) redirect("/admin/tools");

  const [ads, businesses, runs, organization, baseUrl] = await Promise.all([
    listFlyerAds().catch(() => []),
    // Empty until the outreach and business-type migrations run; the list
    // simply shows nobody rather than taking the page down.
    listFlyerBusinesses().catch(() => []),
    listFlyerRuns().catch(() => []),
    getCurrentOrganization().catch(() => null),
    outboundBaseUrl(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <FlyerBuilder ads={ads} />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 pb-10">
        <FlyerRunManager
          runs={runs}
          baseUrl={baseUrl}
          orgSlug={organization?.slug ?? null}
          stripeReady={isStripeConfigured}
        />
        <FlyerOutreachList businesses={businesses} />
      </div>
    </div>
  );
}
