import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { DEFAULT_WIP_LIMITS, type Department, type Stage, type WipLimits } from "@/lib/kanban/board";
import { createClient } from "@/lib/supabase/server";

export interface KanbanCard {
  id: string;
  department: Department;
  stage: Stage;
  position: number;
  title: string;
  details: string | null;
  asked_by: string | null;
  source: "manual" | "ghl";
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
    .select("id, department, stage, position, title, details, asked_by, source, completed_at, created_at")
    .eq("organization_id", organizationId)
    .eq("department", department)
    .or(`stage.neq.validate_done,completed_at.gte.${since}`)
    .order("position")
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as KanbanCard[];
}
