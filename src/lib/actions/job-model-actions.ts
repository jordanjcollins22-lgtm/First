"use server";

import { readFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { loadJobModel } from "@/lib/data/job-model";
import { env, isAnthropicConfigured } from "@/lib/env";
import { reviewPagesEnabled } from "@/lib/review-pages";
import { canRunJobs } from "@/lib/roles";
import { cleanModel, parseSuggestions, suggestionPrompt, suggestionSchema, type PlantSuggestion, type StoredJobModel } from "@/lib/job-model";
import { SAMPLE_AREAS, SAMPLE_JOB_ID, SAMPLE_PHOTOS } from "@/lib/job-model-sample";

/**
 * Saving a job's 3D model, and Claude's read of its photos for plants.
 *
 * Only whoever runs jobs (owner, account manager, project lead) changes the
 * model; the crew see it. The sample job on the review page saves nothing.
 */

const untyped = (c: unknown) => c as SupabaseClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SaveModelResult = { ok: true } | { ok: false; error: string };

export async function saveJobModel(jobId: string, input: StoredJobModel): Promise<SaveModelResult> {
  try {
    if (!UUID.test(jobId)) return { ok: false, error: "The sample job isn't saved." };
    const me = await getCurrentProfile();
    if (!me || !canRunJobs(me.roles)) return { ok: false, error: "Only the office can change the model." };
    const model = cleanModel(input);
    const supabase = await createClient();
    const { error } = await untyped(supabase)
      .from("job_models")
      .upsert(
        { job_id: jobId, plants: model.plants, steps: model.steps, truck: model.truck, video_url: model.videoUrl, updated_at: new Date().toISOString(), updated_by: me.id },
        { onConflict: "job_id" }
      );
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") return { ok: false, error: "Saving needs the database update (0372) first." };
      console.error("[job-model] save failed:", error);
      return { ok: false, error: "Couldn't save. Try again in a moment." };
    }
    revalidatePath(`/jobs/${jobId}/model`);
    return { ok: true };
  } catch (err) {
    console.error("[job-model] save failed:", err);
    return { ok: false, error: "Couldn't save. Try again in a moment." };
  }
}

export type SuggestResult = { ok: true; plants: PlantSuggestion[]; photos: number } | { ok: false; error: string };

/** At most this many photos go to Claude per ask. */
const MAX_PHOTOS = 6;

type Image = Anthropic.ImageBlockParam;

function mediaType(p: string): "image/png" | "image/webp" | "image/jpeg" {
  return p.endsWith(".png") ? "image/png" : p.endsWith(".webp") ? "image/webp" : "image/jpeg";
}

/**
 * Claude reads the job's photos and lists the plants it sees: a name, keep
 * or remove, a rough size and which bed. Nothing is saved: the office ticks
 * the ones that are right and they go on the model, in their bed's middle,
 * to be dragged into place.
 */
export async function suggestPlantsFromPhotos(jobId: string): Promise<SuggestResult> {
  try {
    if (!isAnthropicConfigured) return { ok: false, error: "AI isn't set up on this site yet." };

    let areas: { id: string; name: string; service: string | null }[];
    const images: { image: Image; areaId: string | null }[] = [];

    if (jobId === SAMPLE_JOB_ID) {
      if (!reviewPagesEnabled()) return { ok: false, error: "Not available." };
      areas = SAMPLE_AREAS;
      for (const p of SAMPLE_PHOTOS) {
        const data = await readFile(path.join(process.cwd(), p.file)).catch(() => null);
        if (data) images.push({ image: { type: "image", source: { type: "base64", media_type: "image/jpeg", data: data.toString("base64") } }, areaId: p.areaId });
      }
    } else {
      if (!UUID.test(jobId)) return { ok: false, error: "Not available." };
      const me = await getCurrentProfile();
      if (!me || !canRunJobs(me.roles)) return { ok: false, error: "Only the office can do this." };
      const model = await loadJobModel(jobId);
      if (!model) return { ok: false, error: "Couldn't find that job." };
      areas = model.areas;
      const supabase = await createClient();
      for (const photo of model.photos.slice(0, MAX_PHOTOS)) {
        // Resized by storage, so a phone's 12 MP photo stays under the image limit.
        const { data } = await supabase.storage.from(photo.bucket).download(photo.path, { transform: { width: 1568, resize: "contain" } });
        if (!data) continue;
        const type = data.type?.startsWith("image/") ? (data.type as "image/jpeg") : mediaType(photo.path);
        images.push({ image: { type: "image", source: { type: "base64", media_type: type, data: Buffer.from(await data.arrayBuffer()).toString("base64") } }, areaId: photo.areaId });
      }
    }
    if (images.length === 0) return { ok: false, error: "This job has no photos to read yet." };

    const areaName = new Map(areas.map((a) => [a.id, a.name]));
    const content: Anthropic.ContentBlockParam[] = [];
    images.slice(0, MAX_PHOTOS).forEach(({ image, areaId }, i) => {
      content.push({ type: "text", text: `Photo ${i + 1}${areaId ? `, of ${areaName.get(areaId) ?? "an area"} (${areaId})` : ", area not marked"}:` });
      content.push(image);
    });
    content.push({ type: "text", text: suggestionPrompt(areas) });

    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const response = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: { type: "json_schema", schema: suggestionSchema(areas.map((a) => a.id)) } },
      system: "You identify landscape plants from photos for a landscaping company in Harford County, Maryland, so the crew know what stays and what comes out. Be concrete and conservative.",
      messages: [{ role: "user", content }],
    });
    if (response.stop_reason === "refusal") return { ok: false, error: "Couldn't read these photos." };
    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const plants = parseSuggestions(raw, areas.map((a) => a.id));
    if (plants.length === 0) return { ok: false, error: "No plants found in the photos." };
    return { ok: true, plants, photos: Math.min(images.length, MAX_PHOTOS) };
  } catch (err) {
    console.error("[job-model] suggestions failed:", err);
    return { ok: false, error: "Couldn't read the photos just now. Try again in a moment." };
  }
}
