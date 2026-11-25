import { redirect } from "next/navigation";

import { AccountManagerPhone } from "@/components/phone/screens/account-manager";
import { AffiliatePhone, TechnicianPhone } from "@/components/phone/screens/affiliate-tech";
import { OwnerPhone, PartnerPhone } from "@/components/phone/screens/partner-owner";
import { Screen } from "@/components/phone/parts";
import { getCurrentProfile } from "@/lib/data/team";
import { meScreenFor } from "@/lib/me-screen";

export const dynamic = "force-dynamic";

/**
 * Everyone's full page, drawn exactly as the Project Hub's phone mock-ups
 * draw each role, with their own real data. The home screen (/me) opens
 * straight to each part of it. Drawn as getCurrentProfile(), so Preview as
 * shows exactly that person.
 */
export default async function MeFullPage({ searchParams }: { searchParams: Promise<{ role?: string; range?: string; from?: string; to?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/me/full");
  const { role: asked, ...q } = await searchParams;
  const screen = meScreenFor(profile, asked);
  if (!screen) {
    return (
      <Screen hello={profile.first_name || "Hi"} role="">
        <div className="vx-card">
          <div className="vx-sm">Your page isn&apos;t in the new app yet. Ask Jordan to set your role.</div>
        </div>
      </Screen>
    );
  }

  switch (screen) {
    case "owner":
      return <OwnerPhone profile={profile} q={q} />;
    case "account-manager":
      return <AccountManagerPhone profile={profile} />;
    case "technician":
      return <TechnicianPhone profile={profile} />;
    case "partner":
      return <PartnerPhone profile={profile} />;
    default:
      return <AffiliatePhone profile={profile} />;
  }
}
