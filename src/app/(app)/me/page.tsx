import { redirect } from "next/navigation";

import { HomeScreen } from "@/components/phone/home-screen";
import { Screen } from "@/components/phone/parts";
import { firstName } from "@/components/phone/screens/affiliate-tech";
import { getCurrentProfile } from "@/lib/data/team";
import { meScreenFor } from "@/lib/me-screen";

export const dynamic = "force-dynamic";

/**
 * Everyone's home: a phone home screen. The four in the dock are what this
 * role uses all the time; the icons above are what they use sometimes. Each
 * opens its part of the full page (/me/full) or its own page. Their personal
 * link (/p/<slug>) lands here after they sign in.
 */
export default async function MePage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/me");
  const { role: asked } = await searchParams;
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
  // The owner looking at another role keeps that role on every icon.
  const previewing = asked && asked === screen && screen !== "owner" ? screen : null;
  return <HomeScreen role={screen} name={firstName(profile)} previewing={previewing} />;
}
