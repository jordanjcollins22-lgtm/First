import { notFound, redirect } from "next/navigation";

import { V2Shell } from "@/components/v2/v2-shell";
import { getRealProfile } from "@/lib/data/team";
import { V2_LOADERS } from "@/lib/data/v2";
import { TABS } from "@/lib/permissions";
import { isOwnerLevel } from "@/lib/roles";

export const metadata = { title: "New layout · JS Landscaping" };

type SectionKey = keyof typeof V2_LOADERS;

/**
 * One of the four pages of the new layout, with live data.
 *
 * Owner-level only while it is being built: it is checked against the account
 * actually signed in, not whoever an admin is viewing as, so the preview can't
 * be reached by somebody it wasn't meant for.
 */
export default async function V2SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!(section in V2_LOADERS)) notFound();

  const me = await getRealProfile();
  if (!me) redirect("/login");
  if (!isOwnerLevel(me.roles)) redirect("/");

  const data = await V2_LOADERS[section as SectionKey]();

  // The task list names every current screen that no tab in the new layout
  // links to yet, worked out from the links themselves so it can't go stale.
  let unplaced: { label: string; href: string }[] | undefined;
  if (section === "admin") {
    const rest = await Promise.all(
      (Object.keys(V2_LOADERS) as SectionKey[]).filter((k) => k !== "admin").map((k) => V2_LOADERS[k]())
    );
    const linked = new Set([data, ...rest].flatMap((s) => s.pillars.flatMap((p) => p.links.map((l) => l.href))));
    const seen = new Set<string>();
    unplaced = TABS.filter((t) => !t.href.includes("[") && t.href !== "/" && !linked.has(t.href))
      .filter((t) => (seen.has(t.href) ? false : (seen.add(t.href), true)))
      .map((t) => ({ label: t.label, href: t.href }));
  }

  return <V2Shell section={data} unplaced={unplaced} />;
}
