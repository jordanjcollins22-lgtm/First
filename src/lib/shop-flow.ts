/**
 * The morning at the shop, as a sequence the tablet walks through.
 *
 * Clock in. Load one kit at a time. Go over the maps for the stops the lead
 * picks. Head to the first job. The lead drives it from the shop tablet;
 * everybody else's phone shows the same page and can tick the same list.
 */

import type { Loadout, LoadoutItem } from "@/lib/loadout";

export type ShopStage = "loadout" | "maps" | "en_route";

export interface LoadPage {
  key: string;
  title: string;
  /** What is in it, or what it is for. */
  subtitle: string | null;
  items: LoadoutItem[];
}

/**
 * The load-out as pages: every kit on its own, then whatever is loose.
 *
 * A kit is one thing to grab off the shelf, and one thing to tick; its
 * contents are listed so the person grabbing it can see what should be in
 * it. Loose tools and materials come last, together, because they are
 * picked from all over the shop rather than from one spot.
 */
export function loadPages(loadout: Loadout): LoadPage[] {
  const kits = loadout.items.filter((i) => i.kind === "kit");
  const loose = loadout.items.filter((i) => i.kind !== "kit");
  const pages: LoadPage[] = kits.map((kit) => ({
    key: `kit:${kit.key}`,
    title: `Load ${kit.label}`,
    subtitle: [kit.detail, `For ${kit.forStops.join(", ")}`].filter(Boolean).join(". "),
    items: [kit],
  }));
  if (loose.length > 0) {
    pages.push({ key: "loose", title: "Loose tools and materials", subtitle: "Everything not in a kit.", items: loose });
  }
  return pages;
}

export function pageComplete(page: LoadPage): boolean {
  return page.items.every((i) => i.checked);
}

/** The page to show, never off either end. */
export function clampPage(index: number, pages: LoadPage[]): number {
  if (pages.length === 0) return 0;
  return Math.min(Math.max(0, index), pages.length - 1);
}

export function allLoaded(pages: LoadPage[]): boolean {
  return pages.every(pageComplete);
}

/** Whether this person runs the shop screen: a lead on any stop today, or the office. */
export function canLead(input: { roles: readonly string[]; leadsAStop: boolean }): boolean {
  const office = input.roles.some((r) => r === "owner" || r === "admin" || r === "project-lead");
  return office || input.leadsAStop;
}

export const STAGE_LABEL: Record<ShopStage, string> = {
  loadout: "Loading the truck",
  maps: "Going over the maps",
  en_route: "On the road",
};
