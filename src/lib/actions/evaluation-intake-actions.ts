"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { cleanAnswers } from "@/lib/evaluation-intake";

type Result = { ok: true; submittedAt: string } | { ok: false; error: string };

/**
 * The client's answers, saved.
 *
 * Runs as the service role because the person pressing Send has no account.
 * The token is the authorisation: it names one form and nothing else, and
 * the only thing this can write is that form's answers. Sending again
 * simply replaces them, so a change of mind is one more press of Send.
 */
export async function submitEvaluationIntake(input: {
  token: string;
  answers: unknown;
  together: boolean;
}): Promise<Result> {
  if (!/^[0-9a-f]{24}$/.test(input.token)) return { ok: false, error: "That link is not right." };

  const answers = cleanAnswers(input.answers);
  const admin = createAdminClient();
  const submittedAt = new Date().toISOString();

  const { data, error } = await admin
    .from("evaluation_intakes")
    .update({
      answers,
      submitted_at: submittedAt,
      submitted_by: input.together ? "together" : "client",
      updated_at: submittedAt,
    })
    .eq("token", input.token)
    .select("job_id")
    .maybeSingle();

  if (error) return { ok: false, error: "Could not save that. Try again in a moment." };
  if (!data) return { ok: false, error: "That link has expired or was never ours." };

  revalidatePath(`/jobs/${data.job_id}`);
  return { ok: true, submittedAt };
}
