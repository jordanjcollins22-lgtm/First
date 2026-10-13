import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";

import { PANELS } from "@/components/v2/panels/registry";
import { PanelBoundary, PanelFailed } from "@/components/v2/panels/panel-boundary";
import { log } from "@/lib/log";

import { V2Shell } from "@/components/v2/v2-shell";
import { getCurrentProfile, getRealProfile } from "@/lib/data/team";
import { V2_GROUPS, V2_LOADERS, v2ForViewer } from "@/lib/data/v2";
import { TABS } from "@/lib/permissions";
import { v2PagesFor, v2RolesOf } from "@/lib/v2-roles";

export const metadata = { title: "New layout · JS Landscaping" };

type SectionKey = keyof typeof V2_LOADERS;

/**
 * One of the four pages of the new layout, with live data.
 *
 * Every member of staff gets it, drawn for their roles: the owner sees all
 * four pages; everybody else sees only the pages and home screens their
 * roles have, nothing more.
 *
 * It is drawn as whoever the owner picked in Preview as: their pages, their
 * choices, and their own visits and work days, nothing more and nothing less.
 */
export default async function V2SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!(section in V2_LOADERS)) notFound();

  const me = await getRealProfile();
  if (!me) redirect("/login");

  const viewer = (await getCurrentProfile()) ?? me;
  const roles = v2RolesOf(viewer);
  const pages = v2PagesFor(roles);
  if (!pages.includes(section as SectionKey)) {
    if (pages.length) redirect(`/v2/${pages[0]}`);
    return (
      <p className="py-10 text-center text-muted-foreground">
        {viewer.full_name || viewer.email} has no role that the new layout shows anything for yet.
      </p>
    );
  }
  // "My" views read the person's own work; the owner's own view needs no person.
  const viewerId = roles.includes("owner") ? null : viewer.id;
  const data = v2ForViewer(await V2_LOADERS[section as SectionKey](viewerId), roles);

  // The task list names every current screen that no tab in the new layout
  // links to yet, worked out from the links themselves so it can't go stale.
  let unplaced: { label: string; href: string }[] | undefined;
  if (section === "admin" && roles.includes("owner")) {
    const rest = await Promise.all(
      (Object.keys(V2_LOADERS) as SectionKey[]).filter((k) => k !== "admin").map((k) => V2_LOADERS[k]())
    );
    const linked = new Set([data, ...rest].flatMap((s) => s.pillars.flatMap((p) => [p, ...(p.parts ?? [])]).flatMap((p) => p.links.map((l) => l.href))));
    const seen = new Set<string>();
    unplaced = TABS.filter((t) => !t.href.includes("[") && t.href !== "/" && !linked.has(t.href))
      .filter((t) => (seen.has(t.href) ? false : (seen.add(t.href), true)))
      .map((t) => ({ label: t.label, href: t.href }));
  }

  // The working screens for this page's choices, owner view only. Each streams
  // in on its own, so a slow one never holds up the page.
  const panels: Record<string, React.ReactNode> = {};
  {
    const groups = V2_GROUPS[section as SectionKey];
    const keys = roles.includes("owner")
      ? groups.flatMap((g) => g.panels ?? [])
      : groups.flatMap((g) => roles.flatMap((r) => g.rolePanels?.[r] ?? []));
    for (const key of new Set(keys)) {
      const Panel = PANELS[key];
      if (Panel)
        panels[key] = (
          <PanelBoundary name={key}>
            <Suspense fallback={<PanelLoading />}>
              <SafePanel name={key} render={Panel} />
            </Suspense>
          </PanelBoundary>
        );
    }
  }

  // Keyed by page and person, so the chosen pillar starts fresh on each.
  return <V2Shell key={`${section}:${viewer.id}`} section={data} roles={roles} unplaced={unplaced} panels={panels} />;
}

/** Runs one panel on the server and turns a failure into a card, not a broken page. */
async function SafePanel({ name, render }: { name: string; render: () => Promise<React.JSX.Element> }) {
  try {
    return await render();
  } catch (err) {
    // A redirect or not-found thrown on purpose still has to reach Next.
    if (err && typeof err === "object" && "digest" in err && /^NEXT_/.test(String((err as { digest: unknown }).digest))) throw err;
    log.error("v2.panel_failed", err, { panel: name });
    return <PanelFailed name={name} />;
  }
}

function PanelLoading() {
  return <div className="h-40 animate-pulse rounded-2xl border bg-card/40" aria-busy="true" />;
}
