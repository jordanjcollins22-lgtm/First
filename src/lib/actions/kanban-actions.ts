"use server";

import { revalidatePath } from "next/cache";

import { checkTabAccess } from "@/lib/data/access";
import { getWipLimits } from "@/lib/data/kanban";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import {
  isDepartment,
  isStage,
  parseWipLimit,
  positionAtBottom,
  positionAtTop,
  wipViolation,
  type Department,
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

async function stagePositions(department: Department, stage: Stage): Promise<number[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kanban_cards")
    .select("position")
    .eq("department", department)
    .eq("stage", stage);
  if (error) throw error;
  return (data ?? []).map((r) => r.position);
}

export async function createCard(department: string, formData: FormData): Promise<ActionResult> {
  await guard();
  if (!isDepartment(department)) return { error: "Unknown board." };
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Write the question or task first." };

  const supabase = await createClient();
  const { error } = await supabase.from("kanban_cards").insert({
    organization_id: await getCurrentOrganizationId(),
    department,
    stage: "backlog",
    title,
    details: String(formData.get("details") ?? "").trim() || null,
    asked_by: String(formData.get("asked_by") ?? "").trim() || null,
    position: positionAtBottom(await stagePositions(department, "backlog")),
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
  const { data, error } = await supabase
    .from("kanban_cards")
    .update({
      title,
      details: String(formData.get("details") ?? "").trim() || null,
      asked_by: String(formData.get("asked_by") ?? "").trim() || null,
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

/** Move a card to another stage. It lands at the bottom of that stage. */
export async function moveCard(id: string, to: string): Promise<ActionResult> {
  await guard();
  if (!isStage(to)) return { error: "Unknown column." };
  const supabase = await createClient();

  const { data: card, error } = await supabase
    .from("kanban_cards")
    .select("id, department, stage")
    .eq("id", id)
    .single();
  if (error) throw error;
  if (card.stage === to) return {};

  const { data: board, error: boardError } = await supabase
    .from("kanban_cards")
    .select("stage")
    .eq("department", card.department)
    .neq("stage", "validate_done");
  if (boardError) throw boardError;

  const limits = await getWipLimits(card.department);
  const violation = wipViolation(
    card.stage,
    to,
    (board ?? []).map((r) => r.stage),
    limits
  );
  if (violation) return { error: violation };

  const { error: updateError } = await supabase
    .from("kanban_cards")
    .update({
      stage: to,
      position: positionAtBottom(await stagePositions(card.department, to)),
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
    .select("id, department, stage, position")
    .eq("id", id)
    .single();
  if (error) throw error;

  const { data: siblings, error: siblingsError } = await supabase
    .from("kanban_cards")
    .select("id, position")
    .eq("department", card.department)
    .eq("stage", card.stage)
    .order("position")
    .order("created_at");
  if (siblingsError) throw siblingsError;

  const list = siblings ?? [];
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
    // Renumber the stage so equal positions can't make a swap a no-op.
    const order = list.map((c) => c.id);
    const target = order.indexOf(swapWith.id);
    [order[index], order[target]] = [order[target], order[index]];
    for (let i = 0; i < order.length; i++) {
      const { error: e } = await supabase.from("kanban_cards").update({ position: i }).eq("id", order[i]);
      if (e) throw e;
    }
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
