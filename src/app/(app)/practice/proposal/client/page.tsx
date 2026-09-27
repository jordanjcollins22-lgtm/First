import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { PRACTICE_ADDRESS, PRACTICE_ZONES, practicePriceCents } from "@/lib/practice-sample";
import type { JobProposal } from "@/types/domain";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ProposalView } from "@/components/proposal/proposal-view";

/**
 * The client's proposal page, exactly as a client sees it, for the sample
 * job: what Review proposal opens in the account manager's preview. In
 * preview mode, so nothing on it is recorded or sent.
 */
export const dynamic = "force-dynamic";

export default async function PracticeClientProposalPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("evaluations", "/my-day");
  const organization = await getCurrentOrganization().catch(() => null);

  const now = new Date();
  const zones = PRACTICE_ZONES.map((zone) => ({
    zoneName: zone.name,
    serviceLabel: zone.service,
    scopeText: zone.notes,
    photoPaths: [],
    points: zone.points,
    color: zone.color,
    priceCents: practicePriceCents(zone),
    priceDerived: true,
    performedBy: "own" as const,
  }));
  const proposal = {
    id: "practice",
    job_id: "practice",
    organization_id: "practice",
    token: "practice",
    status: "sent",
    total_cost: Math.round(zones.reduce((sum, z) => sum + z.priceCents, 0) / 100),
    discount_id: null,
    discount_kind: null,
    discount_value: null,
    discount_amount: 0,
    discount_reason: null,
    scope_snapshot: zones,
    site_image_path: null,
    site_image_transform: null,
    recommended_scope: null,
    generated_at: now.toISOString(),
    approved_at: now.toISOString(),
    sent_at: null,
    responded_at: null,
    client_response_note: null,
    valid_days: 14,
    expires_at: new Date(now.getTime() + 14 * 86_400_000).toISOString(),
    payment_path: null,
    payment_path_at: null,
    client_chosen_day: null,
    client_chosen_day_at: null,
    checkout_session_id: null,
    paid_at: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  } as unknown as JobProposal;

  return (
    <ProposalView
      data={{
        proposal,
        serviceNames: {},
        propertyAddress: PRACTICE_ADDRESS,
        customerName: "Sarah Miller",
        organizationName: organization?.name ?? "",
      }}
      token="practice"
      messages={[]}
      preview
    />
  );
}
