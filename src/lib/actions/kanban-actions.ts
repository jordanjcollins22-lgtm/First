"use server";

import { revalidatePath } from "next/cache";

import { checkTabAccess } from "@/lib/data/access";
import { getWipLimits } from "@/lib/data/kanban";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import {
  isDepartment,
  isPipeline,
  isStage,
  PIPELINE_LABELS,
  parseBacklogGroups,
  parseGoals,
  parseQuestion,
  parseWipLimit,
  positionAtBottom,
  positionAtTop,
  wipViolation,
  type Department,
  type Pipeline,
  type Stage,
} from "@/lib/kanban/board";
import { createClient } from "@/lib/supabase/server";

export interface ActionResult {
  error?: string;
}

function revalidateBoard(department: Department) {
  revalidatePath(`/${department}`);
}

/** Every action here needs the Department Boards permission. */
async function guard() {
  const { allowed } = await checkTabAccess("kanban");
  if (!allowed) throw new Error("You don't have access to the department boards.");
}

async function stagePositions(department: Department, pipeline: Pipeline, stage: Stage): Promise<number[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kanban_cards")
    .select("position")
    .eq("department", department)
    .eq("pipeline", pipeline)
    .eq("stage", stage);
  if (error) throw error;
  return (data ?? []).map((r) => r.position);
}

/** Stages of the cards still in play on one pipeline, for its WIP counts. */
async function pipelineStages(department: Department, pipeline: Pipeline): Promise<Stage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kanban_cards")
    .select("stage")
    .eq("department", department)
    .eq("pipeline", pipeline)
    .neq("stage", "validate_done");
  if (error) throw error;
  return (data ?? []).map((r) => r.stage);
}

export async function createCard(department: string, formData: FormData): Promise<ActionResult> {
  await guard();
  if (!isDepartment(department)) return { error: "Unknown board." };
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Write the question or task first." };
  const pipelineRaw = String(formData.get("pipeline") ?? "client");
  const pipeline: Pipeline = isPipeline(pipelineRaw) ? pipelineRaw : "client";

  const supabase = await createClient();
  const { error } = await supabase.from("kanban_cards").insert({
    organization_id: await getCurrentOrganizationId(),
    department,
    pipeline,
    stage: "backlog",
    title,
    details: String(formData.get("details") ?? "").trim() || null,
    asked_by: String(formData.get("asked_by") ?? "").trim() || null,
    backlog_group: String(formData.get("backlog_group") ?? "").trim() || null,
    position: positionAtBottom(await stagePositions(department, pipeline, "backlog")),
  });
  if (error) throw error;
  revalidateBoard(department);
  return {};
}

export async function updateCard(id: string, formData: FormData): Promise<ActionResult> {
  await guard();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "A card needs a title." };
  const supabase = await createClient();

  // Moving a card to the other pipeline puts it at the bottom of the same
  // stage there, and counts toward that pipeline's limit.
  let pipelineMove: { pipeline: Pipeline; position: number } | null = null;
  const pipelineRaw = formData.get("pipeline");
  if (typeof pipelineRaw === "string" && isPipeline(pipelineRaw)) {
    const { data: card, error: cardError } = await supabase
      .from("kanban_cards")
      .select("department, pipeline, stage")
      .eq("id", id)
      .single();
    if (cardError) throw cardError;
    if (card.pipeline !== pipelineRaw) {
      const violation = wipViolation(
        "backlog",
        card.stage,
        await pipelineStages(card.department, pipelineRaw),
        await getWipLimits(card.department)
      );
      if (violation) return { error: `${PIPELINE_LABELS[pipelineRaw]} pipeline: ${violation}` };
      pipelineMove = {
        pipeline: pipelineRaw,
        position: positionAtBottom(await stagePositions(card.department, pipelineRaw, card.stage)),
      };
    }
  }

  const { data, error } = await supabase
    .from("kanban_cards")
    .update({
      ...pipelineMove,
      title,
      details: String(formData.get("details") ?? "").trim() || null,
      asked_by: String(formData.get("asked_by") ?? "").trim() || null,
      // Only the edit form of a card that has groups sends this.
      ...(formData.has("backlog_group")
        ? { backlog_group: String(formData.get("backlog_group") ?? "").trim() || null }
        : {}),
    })
    .eq("id", id)
    .select("department")
    .single();
  if (error) throw error;
  revalidateBoard(data.department);
  return {};
}

export async function deleteCard(id: string): Promise<ActionResult> {
  await guard();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kanban_cards")
    .delete()
    .eq("id", id)
    .select("department")
    .single();
  if (error) throw error;
  revalidateBoard(data.department);
  return {};
}

/**
 * Move a card to another stage. It lands at the bottom of that stage. A card
 * moved into the Backlog can name the group it goes in (null is Other).
 */
export async function moveCard(id: string, to: string, group?: string | null): Promise<ActionResult> {
  await guard();
  if (!isStage(to)) return { error: "Unknown column." };
  const supabase = await createClient();

  const { data: card, error } = await supabase
    .from("kanban_cards")
    .select("id, department, pipeline, stage, backlog_group")
    .eq("id", id)
    .single();
  if (error) throw error;
  const regroup = to === "backlog" && group !== undefined ? { backlog_group: group?.trim().slice(0, 40) || null } : {};
  if (card.stage === to) {
    // Dragged to another group of the Backlog: same stage, new group.
    if (!("backlog_group" in regroup) || regroup.backlog_group === card.backlog_group) return {};
    const { error: e } = await supabase
      .from("kanban_cards")
      .update({ ...regroup, position: positionAtBottom(await stagePositions(card.department, card.pipeline, to)) })
      .eq("id", id);
    if (e) throw e;
    revalidateBoard(card.department);
    return {};
  }

  // Each pipeline counts toward its own limits.
  const limits = await getWipLimits(card.department);
  const violation = wipViolation(card.stage, to, await pipelineStages(card.department, card.pipeline), limits);
  if (violation) return { error: violation };

  const { error: updateError } = await supabase
    .from("kanban_cards")
    .update({
      ...regroup,
      stage: to,
      position: positionAtBottom(await stagePositions(card.department, card.pipeline, to)),
      completed_at: to === "validate_done" ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (updateError) throw updateError;

  revalidateBoard(card.department);
  return {};
}

/** Move a card up, down, or to the top of its stage. The top card is the priority. */
export async function reorderCard(id: string, direction: "up" | "down" | "top"): Promise<ActionResult> {
  await guard();
  const supabase = await createClient();
  const { data: card, error } = await supabase
    .from("kanban_cards")
    .select("id, department, pipeline, stage, position, backlog_group")
    .eq("id", id)
    .single();
  if (error) throw error;

  const { data: siblings, error: siblingsError } = await supabase
    .from("kanban_cards")
    .select("id, position, backlog_group")
    .eq("department", card.department)
    .eq("pipeline", card.pipeline)
    .eq("stage", card.stage)
    .order("position")
    .order("created_at");
  if (siblingsError) throw siblingsError;

  // In a grouped Backlog, up, down and top mean within the card's own group.
  // Other groups keep their positions, so they keep their order too.
  const all = siblings ?? [];
  const list = card.stage === "backlog" ? all.filter((c) => c.backlog_group === card.backlog_group) : all;
  const index = list.findIndex((c) => c.id === id);

  if (direction === "top") {
    if (index <= 0) return {};
    const { error: e } = await supabase
      .from("kanban_cards")
      .update({ position: positionAtTop(list.map((c) => c.position)) })
      .eq("id", id);
    if (e) throw e;
  } else {
    const swapWith = list[direction === "up" ? index - 1 : index + 1];
    if (!swapWith) return {};
    // Swap the two cards' places. Equal positions would make a swap a no-op,
    // so ties are broken first by nudging the lower card just below.
    const a = list[index].position;
    let b = swapWith.position;
    if (a === b) b = direction === "up" ? a - 0.5 : a + 0.5;
    const { error: e1 } = await supabase.from("kanban_cards").update({ position: b }).eq("id", id);
    if (e1) throw e1;
    const { error: e2 } = await supabase.from("kanban_cards").update({ position: a }).eq("id", swapWith.id);
    if (e2) throw e2;
  }

  revalidateBoard(card.department);
  return {};
}

export async function updateWipLimits(department: string, formData: FormData): Promise<ActionResult> {
  await guard();
  if (!isDepartment(department)) return { error: "Unknown board." };
  const breakdown = parseWipLimit(formData.get("breakdown"));
  const answer = parseWipLimit(formData.get("answer"));
  const validate = parseWipLimit(formData.get("validate"));
  if (!breakdown || !answer || !validate) {
    return { error: "Each limit must be a whole number from 1 to 50." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("kanban_boards").upsert({
    organization_id: await getCurrentOrganizationId(),
    department,
    wip_breakdown: breakdown,
    wip_answer: answer,
    wip_validate: validate,
  });
  if (error) throw error;
  revalidateBoard(department);
  return {};
}

/** Save the groups inside a department's Backlog, in order. */
export async function updateBacklogGroups(department: string, formData: FormData): Promise<ActionResult> {
  await guard();
  if (!isDepartment(department)) return { error: "Unknown board." };
  const groups = parseBacklogGroups(formData.get("groups"));

  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const limits = await getWipLimits(department);
  const { error } = await supabase.from("kanban_boards").upsert({
    organization_id: organizationId,
    department,
    wip_breakdown: limits.breakdown,
    wip_answer: limits.answer,
    wip_validate: limits.validate,
    backlog_groups: groups,
  });
  if (error) throw error;
  revalidateBoard(department);
  return {};
}

/** Save what this board asks of Answer and Validate, and its goals. */
export async function updateBoardText(department: string, formData: FormData): Promise<ActionResult> {
  await guard();
  if (!isDepartment(department)) return { error: "Unknown board." };

  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const limits = await getWipLimits(department);
  const { error } = await supabase.from("kanban_boards").upsert({
    organization_id: organizationId,
    department,
    wip_breakdown: limits.breakdown,
    wip_answer: limits.answer,
    wip_validate: limits.validate,
    answer_question: parseQuestion(formData.get("answer_question")),
    validate_question: parseQuestion(formData.get("validate_question")),
    goals: parseGoals(formData.get("goals")),
  });
  if (error) throw error;
  revalidateBoard(department);
  return {};
}
