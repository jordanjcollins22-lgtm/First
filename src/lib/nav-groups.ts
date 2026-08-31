/**
 * The shape of the app: eight places, and everything else behind one door.
 *
 * The nav had grown to seventeen entries, which is a list nobody reads — it
 * is a list people scan for the two things they use. So the work of the
 * business gets named directly and everything else moves to one page called
 * More.
 *
 * Nothing is removed and no address changes. A tool under More is the same
 * tool at the same URL with the same permission on it; it is one tap further
 * away instead of one of seventeen equals. That is the whole point of doing it
 * this way — if a tool turns out to be daily work it gets promoted by moving
 * one line in this file, and if it never gets opened again it costs nobody
 * anything where it is.
 *
 * Which of the eight a person sees is still decided by their permissions.
 * This file decides the order and the grouping; `permissions.ts` decides who
 * gets in.
 */

import { TABS, type TabDefinition } from "@/lib/permissions";

/** The eight, in the order they belong in. Work first, admin last. */
export const PRIMARY_ORDER = [
  "dashboard",
  "contacts",
  "pipeline",
  "evaluations",
  "proposals",
  "conversations",
] as const;

/**
 * What each primary entry is called in the nav.
 *
 * Sometimes different from the permission's own label, because a permission
 * names a page and a nav entry names a destination: the tick is on
 * "Proposals", and what you arrive at is proposals and invoices together.
 */
export const PRIMARY_LABEL: Record<string, string> = {
  dashboard: "Dashboard",
  contacts: "Contacts",
  pipeline: "Pipeline",
  evaluations: "Calendar",
  proposals: "Proposals & Invoices",
  conversations: "Conversations",
};

/** Where each primary entry goes. */
export const PRIMARY_HREF: Record<string, string> = {
  dashboard: "/dashboard",
  contacts: "/contacts",
  pipeline: "/pipeline",
  evaluations: "/evaluations",
  proposals: "/proposals",
  conversations: "/conversations",
};

/**
 * Tabs that are reached through a primary entry rather than listed under
 * More.
 *
 * Invoices is a tab on Proposals; Weather is a tab on the Calendar. Listing
 * them under More as well would be two doors to one room, which is how a
 * "clean and simple" nav grows back into seventeen entries.
 */
export const REACHED_VIA: Record<string, string> = {
  invoices: "proposals",
  weather: "evaluations",
  "conversation-thread": "conversations",
  "conversation-job": "conversations",
  "conversation-call": "conversations",
};

/**
 * Detail pages, which are somewhere you land rather than somewhere you go.
 *
 * Nobody navigates to "Job Detail" — they open a job. Putting these in a menu
 * offers a destination that cannot be reached without first picking which one,
 * so they are left out of both the primary list and More.
 */
export const NOT_A_DESTINATION = new Set([
  "job-detail",
  "client-detail",
  "conversation-thread",
  "conversation-job",
  "conversation-call",
]);

export interface NavEntry {
  key: string;
  label: string;
  href: string;
}

const BY_KEY = new Map(TABS.map((t) => [t.key, t]));

/**
 * The primary entries this person can open, in order.
 *
 * Settings is deliberately not here: it hangs off the admin role directly
 * rather than off a tab, for the reason `permissions.ts` gives — the tab list
 * lives in the database that Settings exists to repair, so a page that could
 * be locked away by the thing it fixes is a trap. The nav adds it separately.
 */
export function primaryNav(allowed: string[]): NavEntry[] {
  const has = new Set(allowed);
  return PRIMARY_ORDER.filter((key) => has.has(key)).map((key) => ({
    key,
    label: PRIMARY_LABEL[key] ?? BY_KEY.get(key)?.label ?? key,
    href: PRIMARY_HREF[key] ?? BY_KEY.get(key)?.href ?? "/",
  }));
}

/** Whether a tab is one of the eight. */
export function isPrimary(key: string): boolean {
  return (PRIMARY_ORDER as readonly string[]).includes(key);
}

/**
 * Everything that is not primary and is somewhere a person can actually go.
 *
 * The list behind the More door. Alphabetical, because there is no meaningful
 * order to a drawer of unrelated tools and a made-up one is just something
 * else to learn.
 */
export function moreTabs(allowed: string[]): TabDefinition[] {
  const has = new Set(allowed);

  return TABS.filter((tab) => {
    if (!has.has(tab.key)) return false;
    if (isPrimary(tab.key)) return false;
    if (NOT_A_DESTINATION.has(tab.key)) return false;

    // Something reached through a primary page is left out -- unless the
    // viewer cannot open that page. Ticking a permission is meant to grant
    // access, and a grant whose only door is a page you were not given is a
    // tick that does nothing. Somebody allowed Invoices but not Proposals
    // gets Invoices here rather than nowhere.
    const via = REACHED_VIA[tab.key];
    if (via) return !has.has(via);

    return true;
  }).sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Every tab that has a place in the structure, primary or not.
 *
 * The test walks this against `TABS` and fails if anything falls through, so
 * a page added later cannot quietly become unreachable. That is the guard
 * that makes the More drawer safe: it holds everything nobody named, rather
 * than everything somebody remembered.
 */
export function placedKeys(): Set<string> {
  const placed = new Set<string>();
  for (const key of PRIMARY_ORDER) placed.add(key);
  for (const key of Object.keys(REACHED_VIA)) placed.add(key);
  for (const key of NOT_A_DESTINATION) placed.add(key);
  for (const tab of TABS) {
    if (!isPrimary(tab.key) && !NOT_A_DESTINATION.has(tab.key) && !REACHED_VIA[tab.key]) {
      placed.add(tab.key);
    }
  }
  return placed;
}
