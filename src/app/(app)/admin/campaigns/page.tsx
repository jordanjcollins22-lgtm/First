import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { createClient } from "@/lib/supabase/server";
import { countAudience, getReadiness, listCampaigns } from "@/lib/data/campaigns";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { CampaignPanel } from "@/components/marketing/campaign-panel";

/**
 * Email campaigns that book work.
 *
 * One offer to the list, sent a little at a time in more than one wording,
 * with the wording that books getting more of the list as it goes. The
 * numbers, the readiness of the domain, and the words, on one screen.
 */
export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("campaigns", "/marketing");

  const [organizationId, supabase] = await Promise.all([getCurrentOrganizationId(), createClient()]);
  const [campaigns, readiness, audience] = await Promise.all([
    listCampaigns().catch(() => []),
    getReadiness(organizationId),
    countAudience(supabase, organizationId).catch(() => 0),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">Email Campaigns</h1>
        <p className="text-sm text-muted-foreground">
          An offer to everyone on the list, sent a few dozen a day and growing, in three wordings. Whichever books
          more gets more of the list. It pauses itself if the receivers push back, so the domain stays clean.
        </p>
      </header>
      <CampaignPanel campaigns={campaigns} readiness={readiness} audience={audience} />
    </div>
  );
}
