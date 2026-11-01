import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { listBoardJobs } from "@/lib/data/job-board";
import { DEFAULT_WIP_LIMITS, positionAtBottom, type Department, type Stage, type WipLimits } from "@/lib/kanban/board";
import { planJobSync } from "@/lib/kanban/job-sync";
import { createClient } from "@/lib/supabase/server";

export interface KanbanCard {
  id: string;
  department: Department;
  stage: Stage;
  position: number;
  title: string;
  details: string | null;
  asked_by: string | null;
  source: "manual" | "ghl" | "job";
  job_id: string | null;
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

export async function listBoardCards(department: Department): Promise<KanbanCard[]> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const since = new Date(Date.now() - FINISHED_VISIBLE_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("kanban_cards")
    .select("id, department, stage, position, title, details, asked_by, source, job_id, completed_at, created_at")
    .eq("organization_id", organizationId)
    .eq("department", department)
    .or(`stage.neq.validate_done,completed_at.gte.${since}`)
    .order("position")
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as KanbanCard[];
}

/**
 * Give every job that still needs doing a card in the Operations Backlog, and
 * take Backlog cards off for jobs that are finished, cancelled or declined.
 * Run each time the Operations board is opened, so it needs no webhook.
 */
export async function syncOperationsBacklog(): Promise<void> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();

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
