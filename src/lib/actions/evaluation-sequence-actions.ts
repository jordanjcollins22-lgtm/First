"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { isSequenceStep, validateStep } from "@/lib/evaluation-sequence";

type Result = { ok: true } | { ok: false; error: string };

async function editor(): Promise<{ ok: true; id: string; organizationId: string } | { ok: false; error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!profile.roles.includes("admin") && !profile.roles.includes("owner")) {
    return { ok: false, error: "Only an owner or admin can change what clients are sent." };
  }
  return { ok: true, id: profile.id, organizationId: profile.organization_id };
}

/** One email in the sequence: on or off, and what it says. */
export async function saveEvaluationSequenceStep(input: {
  step: string;
  enabled: boolean;
  subject: string;
  body: string;
}): Promise<Result> {
  const who = await editor();
  if (!who.ok) return who;
  if (!isSequenceStep(input.step)) return { ok: false, error: "That is not one of the five emails." };
  const problem = validateStep(input);
  if (problem) return { ok: false, error: problem };

  const supabase = await createClient();
  const { error } = await supabase.from("evaluation_sequence_steps").upsert(
    {
      organization_id: who.organizationId,
      step: input.step,
      enabled: input.enabled,
      subject: input.subject.trim(),
      body: input.body.trim(),
      updated_at: new Date().toISOString(),
      updated_by: who.id,
    },
    { onConflict: "organization_id,step" }
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/reminders");
  return { ok: true };
}

/** Back to the wording the app ships with, switched on. */
export async function resetEvaluationSequenceStep(step: string): Promise<Result> {
  const who = await editor();
  if (!who.ok) return who;
  if (!isSequenceStep(step)) return { ok: false, error: "That is not one of the five emails." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("evaluation_sequence_steps")
    .delete()
    .eq("organization_id", who.organizationId)
    .eq("step", step);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/reminders");
  return { ok: true };
}
