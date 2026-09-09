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
      // Behind the same permission as Business, which nobody has been granted
      // and so falls to admins -- and the page narrows it again to owner-level.
      // "Am I still the bottleneck" is nobody's question but the person
      // answerable for it, and a door that opens on somebody else's screen is
      // worse than no door.
      { key: "growth", label: "Growth", tabs: ["dashboard"], blurb: "Five numbers, the one thing in the way, and one button." },
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
      // Availability is not a tab of its own on purpose: the weekly hours and
      // the days off are drawn on the grid itself, which is where somebody
      // looks at them. Separating them would mean rewriting the grid to
      // satisfy a tab, and would put "who is free" on a different screen from
      // "what they are booked on".
      { key: "calendar", label: "Calendar", tabs: ["evaluations"], blurb: "Evaluations and work sessions, with everyone's hours and days off on the grid." },
      { key: "weather", label: "Weather", tabs: ["evaluations", "weather"], blurb: "What the forecasts agree on, and where they do not." },
      { key: "booking", label: "Booking", tabs: ["evaluations"], blurb: "The links clients book themselves with, and the calendars those land on." },
      // Last, and never the opening subtab: the calendar is the thing somebody
      // came for, and a suggestion is an opinion about it.
      { key: "suggestions", label: "Suggestions", tabs: ["evaluations"], blurb: "What the calendar would do, if you agreed with it. It books nothing on its own." },
    ],
  },
  {
    key: "jobs",
    label: "Jobs",
    href: "/jobs",
    question: "How do we perform and close the work?",
    subtabs: [
      // Ready and Needs attention are computed every time they are asked,
      // never stored: Ready is the answer to the pre-start checks, and Needs
      // attention is the open blocking issues. Neither is a status somebody
      // sets, so neither can be left switched on after the fact it described
      // has gone away.
      { key: "upcoming", label: "Upcoming", tabs: ["job-detail"], blurb: "Sold work, scheduled or waiting to be." },
      { key: "ready", label: "Ready", tabs: ["job-detail"], blurb: "Every pre-start check passing and nothing blocking. Safe to send a crew." },
      { key: "active", label: "Active", tabs: ["job-detail"], blurb: "Being worked on now." },
      { key: "attention", label: "Needs attention", tabs: ["job-detail"], blurb: "Something unresolved is stopping these, whatever else they are." },
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
      // Money the business actually received, traced back to what brought it
      // in -- and, just as plainly, the work that cannot be traced at all.
      { key: "attribution", label: "What worked", tabs: ["project-data", "leads"], blurb: "Where the money came from, and where it honestly cannot be traced." },
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
      { key: "messaging", label: "Client messaging", tabs: ["reminders"] },
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

export { MOVED, REACHED_VIA_MORE } from "@/lib/moved-routes";


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
