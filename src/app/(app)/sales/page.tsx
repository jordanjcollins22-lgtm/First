import Link from "next/link";
import { redirect } from "next/navigation";

import { OnlyApp } from "@/components/phone/only-app";
import { Screen } from "@/components/phone/parts";
import { AccountManagerPhone } from "@/components/phone/screens/account-manager";
import { getCurrentProfile } from "@/lib/data/team";
import { meScreenFor } from "@/lib/me-screen";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "evaluations", label: "Evaluations", card: "s-evaluations" },
  { key: "proposals", label: "Proposals", card: "s-proposals" },
  { key: "closed", label: "Closed", card: "s-closed-projects" },
] as const;

/**
 * The Sales app (Jordan, Nov 28): Evaluations (book, go, price on the map),
 * Proposals (approve and send, then the ones waiting on an answer) and Closed
 * projects. Each tab is the account manager's own card, so every button works
 * exactly as it does there.
 */
export default async function SalesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/sales");
  const { tab: asked } = await searchParams;
  const tab = TABS.find((t) => t.key === asked) ?? TABS[0];
  const screen = meScreenFor(profile, "account-manager");
  if (screen !== "account-manager") {
    return (
      <Screen hello="Sales" role="">
        <div className="vx-card">
          <div className="vx-sm">Sales is for the account manager and the owner.</div>
        </div>
      </Screen>
    );
  }

  return (
    <div className="vx-only vx-with-tabs">
      <style>{`.vx-only .vx-screen > :not(#${tab.card}) { display: none; }`}</style>
      <OnlyApp id={tab.card} home="/me" />
      <AccountManagerPhone profile={profile} />
      <div className="vx-app vx-tabs-wrap">
        <nav className="vx-tabs is-fixed" aria-label="Sales">
          {TABS.map((t) => (
            <Link key={t.key} href={`/sales?tab=${t.key}`} className={t.key === tab.key ? "on" : ""} aria-current={t.key === tab.key ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
