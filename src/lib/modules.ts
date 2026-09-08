/**
 * The app as six pieces of work, not thirty-three pages.
 *
 * The navigation used to name the database: Contacts, Pipeline, Proposals,
 * Project Data, Door Hangers, Labels. Every one of those is a real thing, and
 * none of them is a question anybody asks. The questions are: what do I do
 * today, how do I sell this, when does it happen, how do we do the work, where
 * does the next customer come from, and where is everything else.
 *
 * So there are six modules, and every existing page becomes a subtab of one of
 * them. Nothing here holds any feature: a subtab names the permission keys that
 * open it, and the module page renders the component that already existed. That
 * is what keeps this a reorganisation rather than a rewrite -- the permission
 * a person was granted still governs exactly what it governed, it is just
 * reached through a door named after the work.
 *
 * `permissions.ts` still decides who gets in. This file decides what the doors
 * are called and what is behind each one.
 */

import { TABS } from "@/lib/permissions";

export type ModuleKey = "my-day" | "sales" | "schedule" | "jobs" | "marketing" | "more";

export interface ModuleSubtab {
  /** The `?tab=` value. Stable: it is in links people send each other. */
  key: string;
  label: string;
  /**
   * The permission keys that open it, any one of which is enough.
   *
   * Empty means nothing gates it beyond being signed in -- used only where the
   * content is the viewer's own work, which there is nothing to withhold from.
   */
  tabs: string[];
  /** Said on the module page when the subtab is the one open. */
  blurb?: string;
}

export interface AppModule {
  key: ModuleKey;
  label: string;
  href: string;
  /** The question this module answers, shown under its heading. */
  question: string;
  subtabs: ModuleSubtab[];
}

/**
 * The six, in the order of the day: your own work first, then winning it,
 * then when it happens, then doing it, then where the next one comes from,
 * and everything else last.
 */
export const MODULES: readonly AppModule[] = [
  {
    key: "my-day",
    label: "My Day",
    href: "/my-day",
    question: "What do I need to do today?",
    subtabs: [
      { key: "today", label: "Today", tabs: [], blurb: "Your evaluations, jobs, calls and follow-ups." },
      { key: "attention", label: "Needs attention", tabs: [], blurb: "What is stuck, and what it is waiting on." },
      { key: "business", label: "Business", tabs: ["dashboard"], blurb: "The pulse, the targets and the money." },
      { key: "alerts", label: "Alerts", tabs: [] },
    ],
  },
  {
    key: "sales",
    label: "Sales",
    href: "/sales",
    question: "How do I get this customer sold?",
    subtabs: [
      { key: "pipeline", label: "Pipeline", tabs: ["pipeline"], blurb: "Every opportunity, and what is holding it up." },
      { key: "leads", label: "Leads", tabs: ["leads"], blurb: "People being worked toward an evaluation." },
      { key: "evaluations", label: "Evaluations", tabs: ["evaluations"], blurb: "Booked, done, and waiting on a proposal." },
      { key: "proposals", label: "Proposals", tabs: ["proposals", "invoices"], blurb: "What we offered, and what came back." },
      { key: "clients", label: "Clients", tabs: ["contacts"], blurb: "The contact book." },
    ],
  },
  {
    key: "schedule",
    label: "Schedule",
    href: "/schedule",
    question: "When does it happen?",
    subtabs: [
      { key: "calendar", label: "Calendar", tabs: ["evaluations"], blurb: "Evaluations, work sessions, availability and booking links." },
      { key: "weather", label: "Weather", tabs: ["evaluations", "weather"], blurb: "What the forecasts agree on, and where they do not." },
    ],
  },
  {
    key: "jobs",
    label: "Jobs",
    href: "/jobs",
    question: "How do we perform and close the work?",
    subtabs: [
      // Ready and Needs attention are not here yet on purpose: Ready is the
      // answer to a set of pre-start checks and Needs attention is the open
      // blocking issues, and neither exists. A tab that shows the wrong jobs
      // is worse than a missing one -- somebody would drive to a job this
      // screen called Ready.
      { key: "upcoming", label: "Upcoming", tabs: ["job-detail"], blurb: "Sold work, scheduled or waiting to be." },
      { key: "active", label: "Active", tabs: ["job-detail"], blurb: "Being worked on now." },
      { key: "completed", label: "Completed", tabs: ["job-detail"], blurb: "Finished work." },
    ],
  },
  {
    key: "marketing",
    label: "Marketing",
    href: "/marketing",
    question: "How do we generate the next customer?",
    subtabs: [
      { key: "map", label: "Map", tabs: ["project-data"], blurb: "The county, the houses, the zones and the routes." },
      { key: "leads", label: "Leads", tabs: ["leads"], blurb: "Prospects, targets, coverage and the playbooks." },
      { key: "print", label: "Print", tabs: ["door-hangers", "flyer"], blurb: "Door hangers, the flyer and its ad squares." },
      { key: "content", label: "Content", tabs: ["social"], blurb: "Before and after posts from the crew's own photos." },
    ],
  },
  {
    key: "more",
    label: "More",
    href: "/more",
    question: "Where are the company and admin tools?",
    subtabs: [
      { key: "inventory", label: "Inventory", tabs: ["tools", "materials", "labels", "inventory-setup"] },
      { key: "team", label: "Team", tabs: ["team"] },
      { key: "services", label: "Services & pricing", tabs: ["services", "team"] },
      { key: "finance", label: "Finance", tabs: ["payments"] },
      { key: "field-guide", label: "Field guide", tabs: ["weeds"] },
      { key: "data", label: "Data & integrations", tabs: ["house-review", "gis-import"] },
      { key: "knowledge", label: "Knowledge graph", tabs: ["knowledge-graph"] },
    ],
  },
] as const;

const BY_KEY = new Map(MODULES.map((m) => [m.key, m]));

export function moduleFor(key: string): AppModule | null {
  return BY_KEY.get(key as ModuleKey) ?? null;
}

/** Whether a person can open a subtab: any one of its keys is enough. */
export function canOpenSubtab(subtab: ModuleSubtab, allowed: readonly string[]): boolean {
  if (subtab.tabs.length === 0) return true;
  return subtab.tabs.some((key) => allowed.includes(key));
}

/**
 * The subtabs of a module this person can actually open.
 *
 * A module renders only these, so somebody granted Materials but not Tools
 * opens Inventory and sees the materials half -- rather than being handed a
 * page of controls that refuse them, or being refused the page.
 */
export function subtabsFor(key: string, allowed: readonly string[]): ModuleSubtab[] {
  return (moduleFor(key)?.subtabs ?? []).filter((subtab) => canOpenSubtab(subtab, allowed));
}

/**
 * The modules in the nav, for this person.
 *
 * A module with nothing open inside it is left out entirely: a door that opens
 * on a refusal is worse than no door. My Day is always there -- it shows one
 * person their own work, which there is nothing to withhold.
 */
export function navModules(allowed: readonly string[]): AppModule[] {
  return MODULES.filter((mod) => subtabsFor(mod.key, allowed).length > 0);
}

/** The subtab a link asks for, or the first one this person can open. */
export function openingSubtab(key: string, allowed: readonly string[], asked?: string | null): string | null {
  const open = subtabsFor(key, allowed);
  if (asked && open.some((s) => s.key === asked)) return asked;
  return open[0]?.key ?? null;
}

/**
 * Where an old address goes now.
 *
 * Every page that was its own destination is a subtab of a module, and the
 * link somebody bookmarked or texted has to keep working. Kept here beside the
 * modules so a subtab and the addresses that reach it cannot drift apart.
 */
export const MOVED: Record<string, string> = {
  "/dashboard": "/my-day?tab=business",
  "/notifications": "/my-day?tab=alerts",
  "/pipeline": "/sales?tab=pipeline",
  "/contacts": "/sales?tab=clients",
  "/proposals": "/sales?tab=proposals",
  "/evaluations": "/schedule?tab=calendar",
  "/weather": "/schedule?tab=weather",
  "/attractors": "/marketing?tab=map",
  "/leads": "/marketing?tab=leads",
  "/admin/door-hangers": "/marketing?tab=print",
  "/admin/flyer": "/marketing?tab=print",
  "/admin/social": "/marketing?tab=content",
  "/admin/tools": "/more?tab=inventory",
  "/admin/materials": "/more?tab=inventory",
  "/admin/labels": "/more?tab=inventory",
  "/admin/inventory-setup": "/more?tab=inventory",
  "/admin/team": "/more?tab=team",
  "/admin/payments": "/more?tab=finance",
  "/admin/weeds": "/more?tab=field-guide",
  "/admin/houses": "/more?tab=data",
  "/admin/gis-import": "/more?tab=data",
  "/knowledge-graph": "/more?tab=knowledge",
};

/**
 * Every permission key the modules place somewhere.
 *
 * The test walks this against `TABS` and fails when a page exists that no
 * module holds -- which is the guard that makes this reorganisation safe to
 * repeat. A page added later cannot quietly become unreachable just because
 * the nav no longer lists it by name.
 */
export function placedTabKeys(): Set<string> {
  const placed = new Set<string>();
  for (const mod of MODULES) {
    for (const subtab of mod.subtabs) {
      for (const key of subtab.tabs) placed.add(key);
    }
  }
  return placed;
}

/**
 * Pages that are somewhere you land rather than somewhere you go.
 *
 * Nobody navigates to "Job Detail" -- they open a job. These have permissions
 * of their own and no place in a module.
 */
export const LANDED_ON = new Set([
  "job-detail",
  "client-detail",
  "conversation-thread",
  "conversation-job",
  "conversation-call",
  // Reached from the header's Inbox rather than from a module: it is where
  // messages from every job collect, not a step in one job.
  "conversations",
  // The front door for a new evaluation, reached from + New.
  "new-property",
  // A tab on Settings, which hangs off the admin role rather than a key.
  "organizations",
  // Absorbed into the Dashboard's own tabs.
  "journeys",
  // Alerts is a tab on My Day, which is the viewer's own screen and is not
  // gated -- so the key survives for the old address without a module holding
  // it. Gating it here would take a person's own alerts away from them.
  "notifications",
]);

/** Permission keys that no module and no landing page accounts for. */
export function unplacedTabKeys(): string[] {
  const placed = placedTabKeys();
  return TABS.filter((tab) => !placed.has(tab.key) && !LANDED_ON.has(tab.key)).map((tab) => tab.key);
}
