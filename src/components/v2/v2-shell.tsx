"use client";

import { useState } from "react";

import type { V2Pillar, V2Role, V2Section } from "@/lib/data/v2";
import { WebsiteStudio } from "@/components/v2/website-studio";
import { AutomationList } from "@/components/v2/automation-list";
import { PANEL_LABEL } from "@/components/v2/panels/labels";
import { roleHomes } from "@/lib/v2-roles";
import { EntityDrawerProvider, RowItem } from "@/components/v2/entity-drawer";

/**
 * The four-page layout: one page per department, a row of choices across the
 * top, and inside a choice a row of sections. Shown as whoever the owner
 * picked in Preview as, so it is exactly what that person sees. Nothing here
 * links back into the old app: every screen it needs lives on one of the
 * four pages.
 *
 * Kept plain on purpose: no internal tags, no build words, one section on
 * screen at a time.
 */

/** What a working screen is called on its button. */
const labelFor = (key: string) => PANEL_LABEL[key] ?? key;

export function V2Shell({
  section,
  roles,
  unplaced,
  panels = {},
  start,
}: {
  section: V2Section;
  /** Rendered working screens, by key, for the choices that list them. */
  panels?: Record<string, React.ReactNode>;
  /** The views of the person the page is shown as: exactly what they get, nothing more. */
  roles: V2Role[];
  unplaced?: { label: string; href: string }[];
  /** The choice to open on, from a link such as /v2/admin?choice=settings. */
  start?: string;
}) {
  const sees = (p: V2Pillar) => p.who.some((r) => roles.includes(r));
  const isOwner = roles.includes("owner");
  // The working screens a person gets on a choice: the owner's set, or their own role's home.
  const panelKeysFor = (p: V2Pillar): string[] =>
    isOwner ? (p.panels ?? []) : roleHomes(p.rolePanels, roles);
  const visible = section.pillars.filter(sees);
  const [pillarId, setPillarId] = useState<string>((start && visible.some((p) => p.id === start) ? start : visible[0]?.id) ?? "overview");
  const current = visible.find((p) => p.id === pillarId) ?? visible[0];

  // Inside a choice, one section at a time, picked from a row of buttons,
  // rather than everything stacked into one long scroll. Working screens
  // first (they hold what needs doing), then the numbers. The pick is kept
  // per choice, so coming back to a choice lands where you left it.
  // A section with nothing in it is left off rather than shown empty.
  const parts = current ? (current.parts ?? [current]).filter(sees).filter((p) => p.id !== "tasks" || (unplaced?.length ?? 0) > 0) : [];
  const shownPanels = current ? panelKeysFor(current).filter((k) => panels[k]) : [];
  const sections = [
    ...shownPanels.map((k) => ({ key: `panel:${k}`, label: labelFor(k), records: false })),
    ...parts.map((p) => ({ key: `part:${p.id}`, label: p.label, records: true })),
  ];
  const [picked, setPicked] = useState<Record<string, string>>({});
  const activeKey = (current && sections.find((x) => x.key === picked[current.id])?.key) ?? sections[0]?.key;
  const activePart = activeKey?.startsWith("part:") ? parts.find((p) => `part:${p.id}` === activeKey) : undefined;
  const activePanel = activeKey?.startsWith("panel:") ? activeKey.slice(6) : undefined;

  return (
    <EntityDrawerProvider>
    <div className="w-full pb-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {section.name} · updated {section.loadedAt}
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight">{current?.title}</h1>
        </div>
        <p className="max-w-md text-muted-foreground">{current?.sub}</p>
      </div>

      <div className="mb-2 rounded-xl border bg-card p-2">
        <div data-tour="choices" role="tablist" aria-label={`${section.name} choices`} className="flex gap-1.5 overflow-x-auto pb-0.5">
          {visible.map((p) => {
            const on = p.id === current?.id;
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setPillarId(p.id)}
                className={
                  "inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-4 text-sm font-bold " +
                  (on ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted")
                }
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>
      {sections.length > 1 && current && (
        <div data-tour="sections" role="tablist" aria-label={`${current.label} sections`} className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {sections.flatMap((x, i) => {
            const on = x.key === activeKey;
            const tab = (
              <button
                key={x.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setPicked((m) => ({ ...m, [current.id]: x.key }))}
                className={
                  "inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-sm font-semibold " +
                  (on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground")
                }
              >
                {x.label}
              </button>
            );
            // A thin rule between the screens you act on and the records behind them.
            const divide = i > 0 && x.records && !sections[i - 1].records;
            return divide ? [<span key={`rule:${x.key}`} role="presentation" className="mx-1 w-px shrink-0 self-stretch bg-border" />, tab] : [tab];
          })}
        </div>
      )}
      <div className="mb-5" />

      {activePanel && <div key={activePanel}>{panels[activePanel]}</div>}

      {activePart && (
        <div key={activePart.id}>
          {parts.length > 1 && activePart.sub && <p className="mb-3 text-sm text-muted-foreground">{activePart.sub}</p>}
          <PillarBody pillar={activePart} section={section} unplaced={unplaced} />
        </div>
      )}
    </div>
    </EntityDrawerProvider>
  );
}

/** One job's screen: its numbers, or the website studio, or the task list. */
function PillarBody({
  pillar,
  section,
  unplaced,
}: {
  pillar: V2Pillar;
  section: V2Section;
  unplaced?: { label: string; href: string }[];
}) {
  // The task list itself is TaskListPanel (owner_tasks); this keeps only the
  // screens of the old app that no choice reaches yet, worked out live.
  if (pillar.id === "tasks") return <UnplacedScreens unplaced={unplaced ?? []} />;
  if (pillar.view === "website" && section.website) {
    return (
      <div className="grid gap-5">
        <Blocks pillar={pillar} />
        <WebsiteStudio website={section.website} />
      </div>
    );
  }
  if (pillar.view === "automations") {
    return (
      <div className="grid gap-5">
        <AutomationList automations={pillar.automations ?? []} />
        <Blocks pillar={pillar} />
      </div>
    );
  }
  return <Detail pillar={pillar} />;
}

function Blocks({ pillar }: { pillar: V2Pillar }) {
  if (!pillar.blocks.length) return null;
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
      {pillar.blocks.map((b) => (
        <div key={b.t} className="rounded-xl border bg-card p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-bold">{b.t}</h3>
            {b.v && <span className="whitespace-nowrap font-mono text-xl">{b.v}</span>}
          </div>
          {b.d && <p className="mt-1 text-sm text-muted-foreground">{b.d}</p>}
          {b.rows && b.rows.length > 0 && (
            <ul className="mt-2.5 grid gap-1.5 text-sm">
              {b.rows.map((r, i) => (
                <RowItem key={i} row={r} className="rounded-lg bg-muted px-2.5 py-1.5" />
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function Detail({ pillar }: { pillar: V2Pillar }) {
  return (
    <section className="rounded-2xl border bg-card/60 p-5">
      <Blocks pillar={pillar} />
    </section>
  );
}

function UnplacedScreens({ unplaced }: { unplaced: { label: string; href: string }[] }) {
  if (!unplaced.length) return null;
  return (
    <section className="rounded-2xl border bg-card p-5">
      <h3 className="mb-1 text-base font-extrabold">
        Old screens not moved over yet{" "}
        <span className="font-mono text-xs font-normal text-muted-foreground">{unplaced.length}</span>
      </h3>
      <p className="mb-2 text-sm text-muted-foreground">Each still works in the old app until it has a place on one of the four pages.</p>
      <ul className="flex flex-wrap gap-2">
        {unplaced.map((u) => (
          <li key={u.href} className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm">
            {u.label}
          </li>
        ))}
      </ul>
    </section>
  );
}

