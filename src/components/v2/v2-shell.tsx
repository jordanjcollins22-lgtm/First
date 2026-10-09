"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { V2Kind, V2Pillar, V2Role, V2Section } from "@/lib/data/v2";
import { WebsiteStudio } from "@/components/v2/website-studio";

/**
 * The new four-page layout: one page per department, a bar of pillars across
 * the top, and a "Preview as" switch so the owner can see what each role
 * would be shown. Nothing here links back into the current app: this layout
 * replaces it, so every screen it needs gets built into one of the four pages.
 */

const PAGES = [
  { key: "marketing", label: "Marketing" },
  { key: "sales", label: "Sales" },
  { key: "operations", label: "Operations" },
  { key: "admin", label: "Admin" },
] as const;

const TAG: Record<V2Kind, { text: string; cls: string }> = {
  "": { text: "", cls: "" },
  auto: { text: "AUTO", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200" },
  project: { text: "PROJECT", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200" },
  admin: { text: "ADMIN", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200" },
  people: { text: "PEOPLE", cls: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200" },
};

export function V2Shell({ section, unplaced }: { section: V2Section; unplaced?: { label: string; href: string }[] }) {
  const [role, setRole] = useState<V2Role>("owner");
  const visible = useMemo(() => section.pillars.filter((p) => p.who.includes(role)), [section.pillars, role]);
  const [pillarId, setPillarId] = useState<string>(visible[0]?.id ?? "overview");
  const current = visible.find((p) => p.id === pillarId) ?? visible[0];
  const others = section.roles.filter((r) => r.key !== "owner").map((r) => r.label.toLowerCase());

  function pickRole(r: V2Role) {
    setRole(r);
    const first = section.pillars.find((p) => p.who.includes(r));
    setPillarId(first?.id ?? "overview");
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5">
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border bg-card/80 p-2 shadow-sm">
        <nav aria-label="New app pages" className="flex flex-1 flex-wrap gap-1">
          {PAGES.map((p) => (
            <Link
              key={p.key}
              href={`/v2/${p.key}`}
              aria-current={p.key === section.key ? "page" : undefined}
              className={
                "inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold " +
                (p.key === section.key ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted")
              }
            >
              {p.label}
            </Link>
          ))}
        </nav>
        <div role="group" aria-label="Preview as role" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Preview as</span>
          <div className="flex flex-wrap rounded-lg bg-muted p-1">
            {section.roles.map((r) => (
              <button
                key={r.key}
                type="button"
                aria-pressed={role === r.key}
                onClick={() => pickRole(r.key)}
                className={
                  "min-h-10 rounded-md px-3 font-semibold " +
                  (role === r.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")
                }
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

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
        <div role="tablist" aria-label={`${section.name} pillars`} className="flex gap-1.5 overflow-x-auto pb-0.5">
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
      <p className="mb-5 text-sm text-muted-foreground">
        {role === "owner"
          ? `Owner view: every pillar. ${others.length ? `Use Preview as to see what ${others.join(" or ")} would get.` : ""}`
          : "Only the tools this role can use are shown."}
      </p>

      {current && current.id === "overview" && <Overview section={section} pillar={current} role={role} open={setPillarId} />}
      {current && current.id === "tasks" && <TaskList unplaced={unplaced ?? []} />}
      {current && current.view === "website" && section.website && (
        <div className="grid gap-5">
          <Blocks pillar={current} />
          <WebsiteStudio website={section.website} />
        </div>
      )}
      {current && current.id !== "overview" && current.id !== "tasks" && !(current.view === "website" && section.website) && <Detail pillar={current} />}

    </div>
  );
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
                <li key={i} className="rounded-lg bg-muted px-2.5 py-1.5">
                  {r}
                </li>
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

function Overview({ section, pillar, role, open }: { section: V2Section; pillar: V2Pillar; role: V2Role; open: (id: string) => void }) {
  const list = (g: "a" | "b") => section.pillars.filter((p) => p.group === g && p.who.includes(role));
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

/* ------------------------------------------------------------------ */
/* Task list                                                           */
/* ------------------------------------------------------------------ */

type Status = "Not built" | "Partly built";
const TASKS: [string, [string, Status, string][]][] = [
  ["Marketing", [
    ["Overview", "Partly built", "Shell is live here. Numbers come from the tabs below."],
    ["Google Ads", "Not built", "No account connected. Bookings already record ad click IDs."],
    ["Website", "Partly built", "Website editor and live previews are here. Still to do: point the business's own domain at /site, and add photos and reviews to it."],
    ["Door hangers & mail", "Partly built", "Numbers are here. Planning a run or a mailing is still only in the current app."],
    ["Lead lists", "Partly built", "Counts are here. Importing and working a list is still only in the current app."],
    ["Email campaigns", "Partly built", "Campaigns are listed. Writing and starting one is still only in the current app."],
    ["Property managers", "Partly built", "Numbers are here. Approving the emails is still only in the current app."],
    ["Local groups", "Partly built", "Groups are listed. Group rules and paid posts are still only in the current app."],
    ["What worked", "Partly built", "Revenue by channel is here."],
    ["SEO", "Partly built", "Reviews work. Keyword tracker is empty; Business Profile stats not connected."],
    ["Social media › Facebook & Nextdoor", "Partly built", "Tracked links work. Scheduled posts aren't publishing on their date."],
    ["Social media › Instagram, Google Business posts, TikTok, YouTube", "Not built", "Nothing on these channels yet."],
    ["Affiliates", "Partly built", "Codes and links work. Commission payouts never recorded; rates on file aren't 4%."],
    ["Affiliate-only view", "Not built", "An affiliate signing in should land on the comment responder only."],
  ]],
  ["Sales", [
    ["Overview", "Partly built", "Shell is live here."],
    ["Evaluation booking", "Partly built", "Booking and availability work. Routing by area and workload not built."],
    ["Proposals › Pricing formulas", "Partly built", "Most active services have no rate set."],
    ["Automated follow-up", "Partly built", "Proposal and invoice follow-ups work. No-show rebook and seasonal re-engage not built."],
    ["My evaluations (evaluator view)", "Partly built", "The evaluator's visit screens exist; no evaluator-only home in the new layout."],
    ["Evaluators", "Partly built", "Roster and pay are on profiles. No performance view."],
  ]],
  ["Operations", [
    ["Overview", "Partly built", "Shell is live here."],
    ["Scheduling", "Partly built", "Work days exist. Auto-placement and weather reschedule not built; past work days don't close."],
    ["Materials & ordering", "Partly built", "Materials and suppliers work. Purchase orders and delivery tracking not built."],
    ["Completion & close-out", "Partly built", "Walkthroughs and reviews work. Job costing is rarely filled in."],
    ["My projects (project lead view)", "Not built", "No project leads yet and no lead-only home."],
    ["My day (project tech view)", "Partly built", "My Day and crew check-ins exist; no tech-only home in the new layout."],
    ["Project team", "Partly built", "Roster and pay exist. Performance view not built."],
  ]],
  ["Admin", [
    ["Overview", "Partly built", "Shell is live here."],
    ["Departments", "Partly built", "Alerts are computed here; goals per department not built."],
    ["Customer accounts", "Partly built", "Contacts and messages exist. One timeline per customer not built."],
    ["Users & permissions", "Partly built", "Map the old roles onto the new ones and per-tab access."],
    ["Integrations", "Partly built", "GoHighLevel, Stripe, email and banks work. Google Ads not connected."],
    ["Company & compliance", "Partly built", "Locations and designs exist. Insurance, licenses, contracts and legal wording not built."],
    ["Settings", "Partly built", "Services list exists (with duplicates). Service area and notification settings need a screen."],
    ["Account managers", "Partly built", "Role exists. Assignments and oversight not built."],
    ["Hiring (account managers)", "Not built", "The hiring flow covers project tech and project lead only."],
    ["Switch the main address to the new layout", "Not built", "Last step, once everything above is done."],
  ]],
];
const STORE = "v2-build-tasks";

function TaskList({ unplaced }: { unplaced: { label: string; href: string }[] }) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORE);
      // Restoring ticks saved by an earlier visit, on this device only.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setDone(JSON.parse(raw));
    } catch {
      /* private window or blocked storage: start empty */
    }
  }, []);
  function toggle(key: string) {
    setDone((d) => {
      const next = { ...d, [key]: !d[key] };
      try {
        window.localStorage.setItem(STORE, JSON.stringify(next));
      } catch {
        /* not saved, still ticked on screen */
      }
      return next;
    });
  }
  const all = TASKS.flatMap(([, items]) => items);
  const notBuilt = all.filter((i) => i[1] === "Not built").length;
  const ticked = Object.values(done).filter(Boolean).length;

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="mb-4 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <Stat label="Not built" value={notBuilt} cls="bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100" />
        <Stat label="Partly built" value={all.length - notBuilt} cls="bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100" />
        <Stat label="Screens with no tab yet" value={unplaced.length} cls="bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100" />
        <Stat label="Ticked off" value={ticked} cls="bg-muted" />
      </div>
      <p className="mb-5 text-sm text-muted-foreground">Ticks are saved on this device.</p>
      <div className="grid gap-6">
        {TASKS.map(([page, items]) => (
          <div key={page}>
            <h3 className="mb-2 text-base font-extrabold">
              {page} <span className="font-mono text-xs font-normal text-muted-foreground">{items.length}</span>
            </h3>
            <ul className="grid gap-2">
              {items.map(([t, st, note]) => {
                const key = `${page}|${t}`;
                const on = !!done[key];
                return (
                  <li key={key} className="flex items-start gap-3 rounded-lg border px-3 py-2.5">
                    <input
                      id={key}
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(key)}
                      className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]"
                    />
                    <label htmlFor={key} className="flex-1 cursor-pointer">
                      <span className="flex flex-wrap items-baseline gap-2">
                        <span className={"font-bold " + (on ? "text-muted-foreground line-through" : "")}>{t}</span>
                        <span
                          className={
                            "rounded-full px-2 py-0.5 font-mono text-[11px] " +
                            (st === "Not built"
                              ? "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100"
                              : "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100")
                          }
                        >
                          {st}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">{note}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {unplaced.length > 0 && (
          <div>
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
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className={"rounded-lg p-3 " + cls}>
      <div className="text-xs">{label}</div>
      <div className="font-mono text-2xl">{value}</div>
    </div>
  );
}
