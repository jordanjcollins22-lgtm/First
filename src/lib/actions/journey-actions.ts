"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import type { JourneyStepType } from "@/types/domain";
import type { Database } from "@/lib/supabase/database.types";

type JourneyStepUpdate = Database["public"]["Tables"]["journey_steps"]["Update"];

async function requireAdmin() {
  const caller = await getCurrentProfile();
  if (!caller?.roles.includes("admin")) {
    throw new Error("Only admins can manage the Journey Dashboard.");
  }
}

function splitList(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Creates a journey for a role that doesn't have one yet — how new roles get added without a deploy. */
export async function createJourney(formData: FormData) {
  await requireAdmin();
  const organizationId = await getCurrentOrganizationId();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Enter a journey name.");
  const roleKey = slugify(String(formData.get("role_key") ?? name));
  if (!roleKey) throw new Error("Enter a role.");
  const description = String(formData.get("description") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("journeys").insert({
    organization_id: organizationId,
    role_key: roleKey,
    name,
    description,
  });
  if (error) {
    if (error.code === "23505") throw new Error("A journey for that role already exists.");
    throw error;
  }

  revalidatePath("/admin/journeys");
}

export async function deleteJourney(journeyId: string) {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("journeys").delete().eq("id", journeyId);
  if (error) throw error;
  revalidatePath("/admin/journeys");
}

/** Adds a step to a journey — the reusable unit the whole dashboard is built from. */
export async function createJourneyStep(journeyId: string, formData: FormData) {
  await requireAdmin();

  const label = String(formData.get("label") ?? "").trim();
  if (!label) throw new Error("Enter a step name.");
  const stepKey = slugify(String(formData.get("step_key") ?? label));
  if (!stepKey) throw new Error("Enter a step key.");

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("journey_steps")
    .select("order_index")
    .eq("journey_id", journeyId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (existing?.order_index ?? -1) + 1;

  const { error } = await supabase.from("journey_steps").insert({
    journey_id: journeyId,
    step_key: stepKey,
    order_index: nextOrder,
    label,
    step_type: String(formData.get("step_type") ?? "human"),
    role_label: String(formData.get("role_label") ?? "").trim() || null,
    inputs: splitList(formData.get("inputs")),
    outputs: splitList(formData.get("outputs")),
    automations: splitList(formData.get("automations")),
    next_steps: splitList(formData.get("next_steps")).map(slugify),
    clicks: Number(formData.get("clicks") ?? 0) || 0,
    manual_inputs: Number(formData.get("manual_inputs") ?? 0) || 0,
    customer_comms: Number(formData.get("customer_comms") ?? 0) || 0,
    internal_comms: Number(formData.get("internal_comms") ?? 0) || 0,
    texts: Number(formData.get("texts") ?? 0) || 0,
    emails: Number(formData.get("emails") ?? 0) || 0,
    calls: Number(formData.get("calls") ?? 0) || 0,
    est_minutes: formData.get("est_minutes") ? Number(formData.get("est_minutes")) : null,
    is_built: formData.get("is_built") === "on" || formData.get("is_built") === "true",
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  if (error) {
    if (error.code === "23505") throw new Error("A step with that key already exists on this journey.");
    throw error;
  }

  revalidatePath("/admin/journeys");
}

/**
 * Edits any subset of a step's fields — this is what makes the dashboard's
 * numbers "authored data admins can correct" rather than hard-coded.
 */
export async function updateJourneyStep(
  stepId: string,
  patch: Partial<{
    label: string;
    stepType: JourneyStepType;
    roleLabel: string | null;
    inputs: string[];
    outputs: string[];
    automations: string[];
    nextSteps: string[];
    clicks: number;
    manualInputs: number;
    customerComms: number;
    internalComms: number;
    texts: number;
    emails: number;
    calls: number;
    estMinutes: number | null;
    isBuilt: boolean;
    notes: string | null;
  }>
) {
  await requireAdmin();

  const update: JourneyStepUpdate = {};
  if (patch.label !== undefined) update.label = patch.label;
  if (patch.stepType !== undefined) update.step_type = patch.stepType;
  if (patch.roleLabel !== undefined) update.role_label = patch.roleLabel;
  if (patch.inputs !== undefined) update.inputs = patch.inputs;
  if (patch.outputs !== undefined) update.outputs = patch.outputs;
  if (patch.automations !== undefined) update.automations = patch.automations;
  if (patch.nextSteps !== undefined) update.next_steps = patch.nextSteps;
  if (patch.clicks !== undefined) update.clicks = patch.clicks;
  if (patch.manualInputs !== undefined) update.manual_inputs = patch.manualInputs;
  if (patch.customerComms !== undefined) update.customer_comms = patch.customerComms;
  if (patch.internalComms !== undefined) update.internal_comms = patch.internalComms;
  if (patch.texts !== undefined) update.texts = patch.texts;
  if (patch.emails !== undefined) update.emails = patch.emails;
  if (patch.calls !== undefined) update.calls = patch.calls;
  if (patch.estMinutes !== undefined) update.est_minutes = patch.estMinutes;
  if (patch.isBuilt !== undefined) update.is_built = patch.isBuilt;
  if (patch.notes !== undefined) update.notes = patch.notes;

  const supabase = await createClient();
  const { error } = await supabase.from("journey_steps").update(update).eq("id", stepId);
  if (error) throw error;

  revalidatePath("/admin/journeys");
}

export async function deleteJourneyStep(stepId: string) {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("journey_steps").delete().eq("id", stepId);
  if (error) throw error;
  revalidatePath("/admin/journeys");
}
