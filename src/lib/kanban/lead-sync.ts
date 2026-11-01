/**
 * Keeping the Sales backlog in step with the leads to reach out to.
 *
 * A lead is a prospect still marked new or queued that has not asked to be
 * left alone. Each gets one card. A new lead joins at the bottom, and the top
 * card is the priority. On the first fill they go in best score first, so the
 * starting order is a sensible one to reorder from.
 */

import { LEADS_GROUP, type Stage } from "@/lib/kanban/board";

export interface Prospect {
  id: string;
  owner_name: string | null;
  address: string;
  city: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  do_not_contact: boolean;
  score: number | null;
  estimated_ticket: number | null;
}

export interface LeadCardLink {
  id: string;
  prospect_id: string;
  stage: Stage;
}

export interface NewLeadCard {
  prospect_id: string;
  title: string;
  asked_by: string | null;
  details: string | null;
  backlog_group: string;
}

export function needsReachingOut(p: Prospect): boolean {
  return !p.do_not_contact && (p.status === "new" || p.status === "queued");
}

export function cardForProspect(p: Prospect): NewLeadCard {
  const where = [p.address, p.city].filter(Boolean).join(", ");
  const ticket =
    p.estimated_ticket != null
      ? `Worth about ${Number(p.estimated_ticket).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`
      : null;
  return {
    prospect_id: p.id,
    title: `Reach out: ${p.owner_name?.trim() || where}`,
    backlog_group: LEADS_GROUP,
    asked_by: null,
    details: [p.owner_name?.trim() ? where : null, p.phone, p.email, ticket].filter(Boolean).join("\n") || null,
  };
}

export function planLeadSync(prospects: readonly Prospect[], cards: readonly LeadCardLink[]) {
  const open = prospects.filter(needsReachingOut);
  const openIds = new Set(open.map((p) => p.id));
  const carded = new Set(cards.map((c) => c.prospect_id));

  const toAdd = open
    .filter((p) => !carded.has(p.id))
    .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
    .map(cardForProspect);
  // Contacted, converted, rejected or asked to be left alone: off the Backlog.
  // A card somebody has already pulled further along is theirs to finish.
  const toRemove = cards.filter((c) => c.stage === "backlog" && !openIds.has(c.prospect_id)).map((c) => c.id);
  return { toAdd, toRemove };
}
