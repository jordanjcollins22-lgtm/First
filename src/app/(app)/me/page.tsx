import { redirect } from "next/navigation";

import { AccountManagerPhone } from "@/components/phone/screens/account-manager";
import { AffiliatePhone, TechnicianPhone } from "@/components/phone/screens/affiliate-tech";
import { OwnerPhone, PartnerPhone } from "@/components/phone/screens/partner-owner";
import { Screen } from "@/components/phone/parts";
import { getCurrentProfile } from "@/lib/data/team";
import { v2RolesOf } from "@/lib/v2-roles";

export const dynamic = "force-dynamic";

type Screen = "owner" | "account-manager" | "technician" | "affiliate" | "partner";
const SCREENS: Screen[] = ["owner", "account-manager", "technician", "affiliate", "partner"];

/**
 * Everyone's home, drawn exactly as the Project Hub's phone mock-ups draw
 * each role, with their own real data. Their personal link (/p/<slug>) lands
 * here after they sign in. Drawn as getCurrentProfile(), so Preview as shows
 * exactly that person. The owner can also open any role's layout with
 * ?role=, filled with their own data.
 */
export default async function MePage({ searchParams }: { searchParams: Promise<{ role?: string; range?: string; from?: string; to?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/me");
  const roles = v2RolesOf(profile);
  const { role: asked, ...q } = await searchParams;

  let screen: Screen | null = null;
  if (roles.includes("owner")) screen = SCREENS.includes(asked as Screen) ? (asked as Screen) : "owner";
  else if (roles.includes("account-manager")) screen = "account-manager";
  else if (roles.includes("project-lead") || roles.includes("project-technician")) screen = "technician";
  else if (roles.includes("affiliate")) screen = "affiliate";
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
