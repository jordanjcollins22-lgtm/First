"use client";

import { useState } from "react";

import type { V2Kind, V2Pillar, V2Role, V2Section } from "@/lib/data/v2";
import { WebsiteStudio } from "@/components/v2/website-studio";
import { AutomationList } from "@/components/v2/automation-list";
import { PANEL_LABEL } from "@/components/v2/panels/labels";
import { EntityDrawerProvider, RowItem } from "@/components/v2/entity-drawer";

/**
 * The new four-page layout: one page per department, a bar of pillars across
 * the top. Shown as whoever the owner picked in Preview as, so it is exactly
 * what that person sees. Nothing here links back into the current app: this layout
 * replaces it, so every screen it needs gets built into one of the four pages.
 */


const TAG: Record<V2Kind, { text: string; cls: string }> = {
  "": { text: "", cls: "" },
  auto: { text: "AUTO", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200" },
  project: { text: "PROJECT", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200" },
  admin: { text: "ADMIN", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200" },
  people: { text: "PEOPLE", cls: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200" },
};

export function V2Shell({
  section,
  roles,
  unplaced,
  panels = {},
}: {
  section: V2Section;
  /** Rendered working screens, by key, for the choices that list them. */
  panels?: Record<string, React.ReactNode>;
  /** The views of the person the page is shown as: exactly what they get, nothing more. */
  roles: V2Role[];
  unplaced?: { label: string; href: string }[];
}) {
  const sees = (p: V2Pillar) => p.who.some((r) => roles.includes(r));
  const isOwner = roles.includes("owner");
  // The working screens a person gets on a choice: the owner's set, or their own role's home.
  const panelKeysFor = (p: V2Pillar): string[] =>
    isOwner ? (p.panels ?? []) : [...new Set(roles.flatMap((r) => p.rolePanels?.[r] ?? []))];
  const visible = section.pillars.filter(sees);
  const [pillarId, setPillarId] = useState<string>(visible[0]?.id ?? "overview");
  const current = visible.find((p) => p.id === pillarId) ?? visible[0];

  // Inside a choice, one section at a time, picked from a row of buttons,
  // rather than everything stacked into one long scroll. Working screens
  // first (they hold what needs doing), then the numbers. The pick is kept
  // per choice, so coming back to a choice lands where you left it.
  const parts = current ? (current.parts ?? [current]).filter(sees) : [];
  const shownPanels = current ? panelKeysFor(current).filter((k) => panels[k]) : [];
  const sections = [
    ...shownPanels.map((k) => ({ key: `panel:${k}`, label: PANEL_LABEL[k] ?? k })),
    ...parts.map((p) => ({ key: `part:${p.id}`, label: p.label })),
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
          <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {section.name} · new layout preview · live data as of {section.loadedAt}
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight">{current?.title}</h1>
        </div>
        <p className="max-w-md text-muted-foreground">{current?.sub}</p>
      </div>

      <div className="mb-2 rounded-xl border bg-card p-2">
        <div data-tour="choices" role="tablist" aria-label={`${section.name} pillars`} className="flex gap-1.5 overflow-x-auto pb-0.5">
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
                {TAG[p.kind].text && (
                  <span className={"rounded-full px-2 py-0.5 font-mono text-[11px] font-medium " + (on ? "bg-primary text-primary-foreground" : TAG[p.kind].cls)}>
                    {TAG[p.kind].text}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      {sections.length > 1 && current && (
        <div data-tour="sections" role="tablist" aria-label={`${current.label} sections`} className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {sections.map((x) => {
            const on = x.key === activeKey;
            return (
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
          })}
        </div>
      )}
      <div className="mb-5" />

      {activePanel && <div key={activePanel}>{panels[activePanel]}</div>}

      {activePart && (
        <div key={activePart.id}>
          {parts.length > 1 && activePart.sub && <p className="mb-3 text-sm text-muted-foreground">{activePart.sub}</p>}
          <PillarBody pillar={activePart} section={section} roles={roles} open={setPillarId} unplaced={unplaced} />
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
  roles,
  open,
  unplaced,
}: {
  pillar: V2Pillar;
  section: V2Section;
  roles: V2Role[];
  open: (id: string) => void;
  unplaced?: { label: string; href: string }[];
}) {
  // The task list itself is TaskListPanel (owner_tasks); this keeps only the
  // screens of the old app that no choice reaches yet, worked out live.
  if (pillar.id === "tasks") return <UnplacedScreens unplaced={unplaced ?? []} />;
  if (pillar.id === "overview" && !pillar.parts) return <Overview section={section} pillar={pillar} roles={roles} open={open} />;
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

function Overview({ section, pillar, roles, open }: { section: V2Section; pillar: V2Pillar; roles: V2Role[]; open: (id: string) => void }) {
  const list = (g: "a" | "b") => section.pillars.filter((p) => p.group === g && p.who.some((r) => roles.includes(r)));
  return (
    <div className="grid gap-5">
      {pillar.blocks.length > 0 && <Blocks pillar={pillar} />}
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        {(["a", "b"] as const).map((g) =>
          list(g).length ? (
            <section key={g} className="self-start rounded-2xl border bg-card p-5">
              <h2 className="text-xl font-extrabold">{section.groups[g].title}</h2>
              <p className="mb-4 mt-1 text-sm text-muted-foreground">{section.groups[g].note}</p>
              <div className="grid gap-2.5">
                {list(g).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => open(p.id)}
                    className="flex min-h-14 items-center justify-between gap-3 rounded-lg border bg-muted/50 px-4 py-3 text-left hover:bg-muted"
                  >
                    <span>
                      <span className="block font-bold">{p.label}</span>
                      {p.blurb && <span className="text-sm text-muted-foreground">{p.blurb}</span>}
                    </span>
                    {TAG[p.kind].text && (
                      <span className={"whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[11px] " + TAG[p.kind].cls}>{TAG[p.kind].text}</span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          ) : null
        )}
      </div>
    </div>
  );
}

function UnplacedScreens({ unplaced }: { unplaced: { label: string; href: string }[] }) {
  if (!unplaced.length) return null;
  return (
    <section className="rounded-2xl border bg-card p-5">
      <h3 className="mb-1 text-base font-extrabold">
        Current screens with no tab in the new layout yet{" "}
        <span className="font-mono text-xs font-normal text-muted-foreground">{unplaced.length}</span>
      </h3>
      <p className="mb-2 text-sm text-muted-foreground">Each one needs a home on one of the four pages.</p>
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

