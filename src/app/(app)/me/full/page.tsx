import { redirect } from "next/navigation";

import { AccountManagerPhone } from "@/components/phone/screens/account-manager";
import { AffiliatePhone, TechnicianPhone } from "@/components/phone/screens/affiliate-tech";
import { OwnerPhone, PartnerPhone } from "@/components/phone/screens/partner-owner";
import { OnlyApp } from "@/components/phone/only-app";
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
export default async function MeFullPage({ searchParams }: { searchParams: Promise<{ role?: string; range?: string; from?: string; to?: string; app?: string }> }) {
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

  const body =
    screen === "owner" ? (
      <OwnerPhone profile={profile} q={q} />
    ) : screen === "account-manager" ? (
      <AccountManagerPhone profile={profile} />
    ) : screen === "technician" ? (
      <TechnicianPhone profile={profile} />
    ) : screen === "partner" ? (
      <PartnerPhone profile={profile} />
    ) : (
      <AffiliatePhone profile={profile} />
    );

  // One app from the home screen: only that part shows, with a way back home.
  const app = q.app && /^s-[a-z0-9-]+$/.test(q.app) ? q.app : null;
  if (!app) return body;
  const previewing = asked && asked === screen && screen !== "owner";
  return (
    <div className="vx-only">
      <style>{`.vx-only .vx-screen > :not(#${app}) { display: none; }`}</style>
      <OnlyApp id={app} home={previewing ? `/me?role=${screen}` : "/me"} />
      {body}
    </div>
  );
}
