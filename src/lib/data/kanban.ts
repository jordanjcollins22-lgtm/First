import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { listBoardJobs } from "@/lib/data/job-board";
import { DEFAULT_BACKLOG_GROUPS, DEFAULT_BOARD_TEXT, DEFAULT_WIP_LIMITS, EXTERNAL_GROUP, type BoardText, LEGACY_EXTERNAL_GROUPS, positionAtBottom, type Department, type Stage, type WipLimits } from "@/lib/kanban/board";
import { planJobSync } from "@/lib/kanban/job-sync";
import { planLeadSync, type Prospect } from "@/lib/kanban/lead-sync";
import {
  NEW_LEAD_DAYS,
  leadFacts,
  planCustomerSync,
  type LeadFacts,
  type LeadJob,
  type NewCustomer,
} from "@/lib/kanban/customer-sync";
import { createClient } from "@/lib/supabase/server";

export interface KanbanCard {
  id: string;
  department: Department;
  stage: Stage;
  position: number;
  title: string;
  details: string | null;
  asked_by: string | null;
  source: "manual" | "ghl" | "job" | "lead" | "customer";
  job_id: string | null;
  customer_id: string | null;
  /** For a Marketing lead: whether they booked an evaluation and a job. */
  facts?: LeadFacts;
  backlog_group: string | null;
  completed_at: string | null;
  created_at: string;
}

/** Finished cards stay on the board this long, then drop off. */
export const FINISHED_VISIBLE_DAYS = 7;

export async function getWipLimits(department: Department): Promise<WipLimits> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const { data, error } = await supabase
    .from("kanban_boards")
    .select("wip_breakdown, wip_answer, wip_validate")
    .eq("organization_id", organizationId)
    .eq("department", department)
    .maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_WIP_LIMITS;
  return { breakdown: data.wip_breakdown, answer: data.wip_answer, validate: data.wip_validate };
}

/** The groups inside this department's Backlog, in order. */
export async function getBacklogGroups(department: Department): Promise<string[]> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const { data, error } = await supabase
    .from("kanban_boards")
    .select("backlog_groups")
    .eq("organization_id", organizationId)
    .eq("department", department)
    .maybeSingle();
  if (error) throw error;
  return data?.backlog_groups ?? DEFAULT_BACKLOG_GROUPS[department];
}

export async function listBoardCards(department: Department): Promise<KanbanCard[]> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const since = new Date(Date.now() - FINISHED_VISIBLE_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("kanban_cards")
    .select("id, department, stage, position, title, details, asked_by, source, job_id, customer_id, backlog_group, completed_at, created_at")
    .eq("organization_id", organizationId)
    .eq("department", department)
    .or(`stage.neq.validate_done,completed_at.gte.${since}`)
    .order("position")
    .order("created_at");
  if (error) throw error;
  const cards = (data ?? []) as KanbanCard[];

  // Marketing's two questions are answered from the app: did the lead book
  // an evaluation, and did they book the job.
  const customerIds = cards.map((c) => c.customer_id).filter((id): id is string => Boolean(id));
  if (customerIds.length > 0) {
    const facts = await getLeadFacts(customerIds);
    for (const card of cards) {
      if (card.customer_id) card.facts = facts.get(card.customer_id) ?? { bookedEval: false, bookedJob: false };
    }
  }
  return cards;
}

/** Whether each lead booked an evaluation and a job, from their properties' jobs. */
async function getLeadFacts(customerIds: string[]): Promise<Map<string, LeadFacts>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("properties")
    .select("customer_id, jobs(status, evaluation_date, declined_at)")
    .in("customer_id", customerIds);
  if (error) throw error;
  const jobsByCustomer = new Map<string, LeadJob[]>();
  for (const row of (data ?? []) as unknown as { customer_id: string; jobs: LeadJob[] | null }[]) {
    jobsByCustomer.set(row.customer_id, [...(jobsByCustomer.get(row.customer_id) ?? []), ...(row.jobs ?? [])]);
  }
  return new Map(customerIds.map((id) => [id, leadFacts(jobsByCustomer.get(id) ?? [])]));
}

/** What this board asks of Answer and Validate, and its goals. */
export async function getBoardText(department: Department): Promise<BoardText> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const { data, error } = await supabase
    .from("kanban_boards")
    .select("answer_question, validate_question, goals")
    .eq("organization_id", organizationId)
    .eq("department", department)
    .maybeSingle();
  if (error) throw error;
  const fallback = DEFAULT_BOARD_TEXT[department];
  // A board saves all three together, so a saved row speaks for all three.
  if (!data || (data.answer_question == null && data.validate_question == null && data.goals == null)) {
    return fallback;
  }
  return {
    answerQuestion: data.answer_question,
    validateQuestion: data.validate_question,
    goals: data.goals ?? [],
  };
}

/**
 * Give every new lead a card in the Marketing Backlog: a client created in
 * the last few weeks, not from a bulk import. Run each time the Marketing
 * board is opened. Leads are never taken off by this; the team moves them on.
 */
export async function syncMarketingBacklog(): Promise<void> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const since = new Date(Date.now() - NEW_LEAD_DAYS * 86_400_000).toISOString();

  const [customersResult, cardsResult] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name, phone, email, source, created_at, properties(address)")
      .eq("organization_id", organizationId)
      .gte("created_at", since)
      .is("import_batch", null)
      .in("contact_type", ["client", "lead"])
      .eq("do_not_contact", false)
      .limit(500),
    supabase
      .from("kanban_cards")
      .select("customer_id")
      .eq("organization_id", organizationId)
      .not("customer_id", "is", null),
  ]);
  if (customersResult.error) throw customersResult.error;
  if (cardsResult.error) throw cardsResult.error;

  const customers: NewCustomer[] = (
    (customersResult.data ?? []) as unknown as (Omit<NewCustomer, "address"> & { properties: { address: string | null }[] | null })[]
  ).map(({ properties, ...c }) => ({ ...c, address: properties?.[0]?.address ?? null }));
  const carded = new Set((cardsResult.data ?? []).map((r) => r.customer_id as string));
  const toAdd = planCustomerSync(customers, carded);
  if (toAdd.length === 0) return;

  const { data: backlog, error: backlogError } = await supabase
    .from("kanban_cards")
    .select("position")
    .eq("organization_id", organizationId)
    .eq("department", "marketing")
    .eq("stage", "backlog");
  if (backlogError) throw backlogError;
  const start = positionAtBottom((backlog ?? []).map((r) => r.position));

  const { error } = await supabase.from("kanban_cards").upsert(
    toAdd.map((card, i) => ({
      ...card,
      organization_id: organizationId,
      department: "marketing" as const,
      stage: "backlog" as const,
      source: "customer" as const,
      position: start + i,
    })),
    { onConflict: "customer_id", ignoreDuplicates: true }
  );
  if (error) throw error;
}

/**
 * Cards made from jobs and leads before every Backlog had External and
 * Internal groups had no group, or "Leads". File them under External. Once
 * they are, this matches nothing.
 */
async function fileAutoCardsAsExternal(department: Department, organizationId: string): Promise<void> {
  const supabase = await createClient();
  const legacy = LEGACY_EXTERNAL_GROUPS.map((g) => `"${g}"`).join(",");
  const { error } = await supabase
    .from("kanban_cards")
    .update({ backlog_group: EXTERNAL_GROUP })
    .eq("organization_id", organizationId)
    .eq("department", department)
    .in("source", ["job", "lead"])
    .or(`backlog_group.is.null,backlog_group.in.(${legacy})`);
  if (error) throw error;
}

/**
 * Give every job that still needs doing a card in the Operations Backlog, and
 * take Backlog cards off for jobs that are finished, cancelled or declined.
 * Run each time the Operations board is opened, so it needs no webhook.
 */
export async function syncOperationsBacklog(): Promise<void> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  await fileAutoCardsAsExternal("operations", organizationId);

  const [jobs, cardsResult] = await Promise.all([
    listBoardJobs(),
    supabase
      .from("kanban_cards")
      .select("id, job_id, stage, position")
      .eq("organization_id", organizationId)
      .eq("department", "operations")
      .not("job_id", "is", null),
  ]);
  if (cardsResult.error) throw cardsResult.error;
  const cards = (cardsResult.data ?? []) as { id: string; job_id: string; stage: Stage; position: number }[];

  const { toAdd, toRemove } = planJobSync(jobs, cards);

  if (toRemove.length > 0) {
    const { error } = await supabase.from("kanban_cards").delete().in("id", toRemove);
    if (error) throw error;
  }
  if (toAdd.length === 0) return;

  const { data: backlog, error: backlogError } = await supabase
    .from("kanban_cards")
    .select("position")
    .eq("organization_id", organizationId)
    .eq("department", "operations")
    .eq("stage", "backlog");
  if (backlogError) throw backlogError;
  const start = positionAtBottom((backlog ?? []).map((r) => r.position));

  // Two people opening the board at once both try to add the same job; the
  // unique index on job_id keeps one, and the other is ignored.
  const { error } = await supabase.from("kanban_cards").upsert(
    toAdd.map((card, i) => ({
      ...card,
      organization_id: organizationId,
      department: "operations" as const,
      stage: "backlog" as const,
      source: "job" as const,
      position: start + i,
    })),
    { onConflict: "job_id", ignoreDuplicates: true }
  );
  if (error) throw error;
}

/**
 * Give every lead that needs reaching out to a card in the Sales Backlog, and
 * take Backlog cards off for leads that were contacted, converted, rejected or
 * asked to be left alone. Run each time the Sales board is opened.
 */
export async function syncSalesBacklog(): Promise<void> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  await fileAutoCardsAsExternal("sales", organizationId);

  const [prospectsResult, cardsResult] = await Promise.all([
    supabase
      .from("lead_prospects")
      .select("id, owner_name, address, city, phone, email, status, do_not_contact, score, estimated_ticket")
      .eq("organization_id", organizationId)
      .in("status", ["new", "queued"])
      .eq("do_not_contact", false)
      .limit(2000),
    supabase
      .from("kanban_cards")
      .select("id, prospect_id, stage")
      .eq("organization_id", organizationId)
      .eq("department", "sales")
      .not("prospect_id", "is", null),
  ]);
  if (prospectsResult.error) throw prospectsResult.error;
  if (cardsResult.error) throw cardsResult.error;

  const { toAdd, toRemove } = planLeadSync(
    (prospectsResult.data ?? []) as unknown as Prospect[],
    (cardsResult.data ?? []) as { id: string; prospect_id: string; stage: Stage }[]
  );

  if (toRemove.length > 0) {
    const { error } = await supabase.from("kanban_cards").delete().in("id", toRemove);
    if (error) throw error;
  }
  if (toAdd.length === 0) return;

  const { data: backlog, error: backlogError } = await supabase
    .from("kanban_cards")
    .select("position")
    .eq("organization_id", organizationId)
    .eq("department", "sales")
    .eq("stage", "backlog");
  if (backlogError) throw backlogError;
  const start = positionAtBottom((backlog ?? []).map((r) => r.position));

  const { error } = await supabase.from("kanban_cards").upsert(
    toAdd.map((card, i) => ({
      ...card,
      organization_id: organizationId,
      department: "sales" as const,
      stage: "backlog" as const,
      source: "lead" as const,
      position: start + i,
    })),
    { onConflict: "prospect_id", ignoreDuplicates: true }
  );
  if (error) throw error;
}
