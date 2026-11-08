"use server";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { revalidatePath } from "next/cache";

import { env, isAnthropicConfigured } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getBusinessVariables, readProjectInput } from "@/lib/data/business-variables";
import { refuseInDemo } from "@/lib/demo-mode";
import { cleanAnswers } from "@/lib/evaluation-intake";
import { canSeeJobMoney } from "@/lib/roles";
import { cleanSuggestion, PhotoSuggestionSchema, suggestionBrief, suggestionSystemPrompt } from "@/lib/pricing-photo-suggestion";
import type { AreaSuggestion } from "@/lib/pricing-report";

type Saved = { ok: true; savedAt: string } | { ok: false; error: string };

/** Most photos sent for one area: enough to read it, not so many the answer is slow. */
const PHOTOS_PER_AREA = 4;

/** The signed-in person, when they may price this job; the job is checked under their own row security. */
async function pricer(jobId: string) {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  if (!canSeeJobMoney(profile.roles) && !profile.roles.includes("admin")) return null;
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("id").eq("id", jobId).maybeSingle();
  return job ? profile : null;
}

/** Saves the office's input to a job's pricing report: areas, tasks, confirmed conditions, crew and direct costs. */
export async function savePricingEstimate(jobId: string, input: unknown): Promise<Saved> {
  await refuseInDemo();
  const who = await pricer(jobId);
  if (!who) return { ok: false, error: "You can't price this job." };
  const clean = readProjectInput(input, { name: "Project", areas: [] });
  const savedAt = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("pricing_estimates" as never)
    .upsert({ organization_id: who.organization_id, job_id: jobId, input: clean, updated_at: savedAt, updated_by: who.id } as never, { onConflict: "job_id" });
  if (error) {
    console.error("[pricing-estimates] save failed:", error.message);
    return { ok: false, error: /pricing_estimates/.test(error.message) ? "This can't be saved until database update 0371 is applied." : "Couldn't save that. Try again." };
  }
  revalidatePath(`/jobs/${jobId}/pricing-report`);
  return { ok: true, savedAt };
}

/**
 * Claude's read of one area's photos: the conditions it can see and the
 * tasks, with counts for anything counted. Only a suggestion: it goes beside
 * the area for the office to confirm or change, and nothing is priced from it
 * until they do. Anything that goes wrong is a plain message and the office
 * fills it in themselves.
 */
export async function suggestAreaFromPhotos(input: {
  jobId: string;
  area: { name: string; photos: string[]; wants?: string | null; taskKeys: string[] };
}): Promise<{ ok: true; suggestion: AreaSuggestion } | { ok: false; error: string }> {
  try {
    const who = await pricer(input.jobId);
    if (!who) return { ok: false, error: "You can't price this job." };
    if (!isAnthropicConfigured) return { ok: false, error: "Photo suggestions aren't set up on this site yet." };

    // Only photos that belong to this job: its own photos and its intake form's.
    const admin = createAdminClient();
    const [{ data: own }, { data: intake }] = await Promise.all([
      admin.from("job_photos").select("path").eq("job_id", input.jobId),
      admin.from("evaluation_intakes").select("answers").eq("job_id", input.jobId).maybeSingle(),
    ]);
    const allowed = new Set([...((own ?? []) as { path: string }[]).map((p) => p.path), ...cleanAnswers(intake?.answers).photos]);
    const paths = input.area.photos.filter((p) => allowed.has(p)).slice(0, PHOTOS_PER_AREA);
    if (paths.length === 0) return { ok: false, error: "This area has no photos to read." };

    const images: Anthropic.Beta.BetaImageBlockParam[] = [];
    for (const path of paths) {
      const { data: file } = await admin.storage.from("job-photos").download(path);
      if (!file) continue;
      const type = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";
      images.push({ type: "image", source: { type: "base64", media_type: type, data: Buffer.from(await file.arrayBuffer()).toString("base64") } });
    }
    if (images.length === 0) return { ok: false, error: "Couldn't open this area's photos." };

    const { variables } = await getBusinessVariables(await createClient(), who.organization_id);
    const labels = new Map(variables.rates.map((r) => [r.key, r.task]));
    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const response = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      // Looking at a yard and naming what is in it: a careful glance, not a study.
      output_config: { effort: "low", format: betaZodOutputFormat(PhotoSuggestionSchema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: suggestionSystemPrompt(variables.rates),
      messages: [
        {
          role: "user",
          content: [...images, { type: "text", text: suggestionBrief({ name: input.area.name, wants: input.area.wants, taskLabels: input.area.taskKeys.map((k) => labels.get(k) ?? k) }) }],
        },
      ],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) return { ok: false, error: "Couldn't read these photos. Fill the conditions in by hand." };
    return { ok: true, suggestion: cleanSuggestion(response.parsed_output, variables.rates, new Date().toISOString()) };
  } catch (err) {
    console.error("[pricing-estimates] photo suggestion failed:", err instanceof Error ? err.message : String(err));
    return { ok: false, error: "Couldn't read the photos just now. Try again in a moment." };
  }
}

