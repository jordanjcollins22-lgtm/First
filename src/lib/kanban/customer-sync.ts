/**
 * Keeping the Marketing backlog in step with new leads.
 *
 * Marketing's question is whether what it does brings people in, so its
 * Backlog is the people who just came in: each client created in the last
 * few weeks (booked online, an ad, a tracked link, a call), not bulk
 * imports. Each gets one card, oldest first on the first fill, then new
 * leads at the bottom. A lead stays until somebody moves it on: whether
 * they booked is the question the board is there to answer.
 */

import { EXTERNAL_GROUP } from "@/lib/kanban/board";

/** How far back a client counts as a new lead. */
export const NEW_LEAD_DAYS = 30;

export interface NewCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  address: string | null;
  created_at: string;
}

export interface NewCustomerCard {
  customer_id: string;
  title: string;
  asked_by: null;
  details: string | null;
  backlog_group: string;
}

export function cardForCustomer(c: NewCustomer): NewCustomerCard {
  const lines = [
    c.phone ? `Phone: ${c.phone}` : null,
    c.email ? `Email: ${c.email}` : null,
    c.address ? `Address: ${c.address}` : null,
    `Source: ${c.source?.trim() || "Unknown"}`,
  ].filter(Boolean);
  return {
    customer_id: c.id,
    title: c.name.trim() || c.address || "New lead",
    asked_by: null,
    details: lines.join("\n"),
    backlog_group: EXTERNAL_GROUP,
  };
}

export function planCustomerSync(customers: readonly NewCustomer[], cardedCustomerIds: ReadonlySet<string>) {
  return customers
    .filter((c) => !cardedCustomerIds.has(c.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(cardForCustomer);
}

/** A lead's job, as far as Marketing's two questions need it. */
export interface LeadJob {
  status: string;
  evaluation_date: string | null;
  declined_at: string | null;
}

export interface LeadFacts {
  /** Did they book an evaluation? */
  bookedEval: boolean;
  /** Did they book the job: a sold job that wasn't then declined? */
  bookedJob: boolean;
}

const SOLD = new Set(["approved", "in_progress", "completed"]);
const PAST_EVAL = new Set(["quoted", ...SOLD]);

export function leadFacts(jobs: readonly LeadJob[]): LeadFacts {
  return {
    bookedEval: jobs.some((j) => j.evaluation_date != null || PAST_EVAL.has(j.status)),
    bookedJob: jobs.some((j) => SOLD.has(j.status) && !j.declined_at),
  };
}
