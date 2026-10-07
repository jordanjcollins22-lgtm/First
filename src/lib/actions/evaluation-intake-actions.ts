"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { answeredCount, cleanAnswers, MAX_INTAKE_PHOTOS, PHOTO_AREAS, PHOTOS_PER_AREA } from "@/lib/evaluation-intake";
import { log } from "@/lib/log";

type Result = { ok: true; submittedAt: string } | { ok: false; error: string };

const TOKEN = /^[0-9a-f]{24}$/;

/** The form behind a token, as the service role sees it. */
async function formFor(token: string) {
  if (!TOKEN.test(token)) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("evaluation_intakes").select("id, job_id, answers").eq("token", token).maybeSingle();
  return data ? { admin, id: data.id, jobId: data.job_id, answers: cleanAnswers(data.answers) } : null;
}

/**
 * The client's answers, saved.
 *
 * Runs as the service role because the person pressing Send has no account.
 * The token is the authorisation: it names one form and nothing else, and
 * the only thing this can write is that form's answers. Sending again
 * simply replaces them, so a change of mind is one more press of Send.
 * Photos are the one thing not taken from what was sent: they are saved as
 * they are added, so the row already has them.
 */
export async function submitEvaluationIntake(input: {
  token: string;
  answers: unknown;
  together: boolean;
}): Promise<Result> {
  const form = await formFor(input.token);
  if (!form) return { ok: false, error: "That link has expired or was never ours." };

  const answers = { ...cleanAnswers(input.answers), photos: form.answers.photos, photo_areas: form.answers.photo_areas };
  const submittedAt = new Date().toISOString();

  const { error } = await form.admin
    .from("evaluation_intakes")
    .update({
      answers,
      submitted_at: submittedAt,
      submitted_by: input.together ? "together" : "client",
      updated_at: submittedAt,
    })
    .eq("id", form.id);

  if (error) return { ok: false, error: "Could not save that. Try again in a moment." };

  log.info("intake.submitted", { jobId: form.jobId, together: input.together, answered: answeredCount(answers) });
  revalidatePath(`/jobs/${form.jobId}`);
  return { ok: true, submittedAt };
}

type PhotoResult = { ok: true; path: string; url: string } | { ok: false; error: string };

/*
 * One photo of the property, kept with the form the moment it is added, so
 * it is not lost if they never press Send. Shrunk on the phone first, then
 * uploaded in two steps: startIntakePhoto, the upload, finishIntakePhoto.
 */

/** Biggest photo taken straight to storage. Shrunk on the phone, it is a few hundred kilobytes. */
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

function roomFor(answers: { photos: string[]; photo_areas: Record<string, string> }, area: string): string | null {
  if (!PHOTO_AREAS.some((a) => a.value === area)) return "Which part of the yard is that of?";
  const inArea = answers.photos.filter((p) => (answers.photo_areas[p] ?? "whole") === area).length;
  if (inArea >= PHOTOS_PER_AREA) return `${PHOTOS_PER_AREA} photos of this part is plenty. Remove one to add another.`;
  if (answers.photos.length >= MAX_INTAKE_PHOTOS) return "That's plenty of photos. Remove one to add another.";
  return null;
}

/**
 * A place in storage for one photo, which the phone uploads to directly.
 *
 * The photo does not pass through this server: a server action takes at
 * most a megabyte, and a phone photo the browser couldn't shrink is three
 * or four, which failed with nothing on screen to say so.
 */
export async function startIntakePhoto(input: { token: string; area: string; type: string; size: number }): Promise<
  { ok: true; path: string; uploadToken: string } | { ok: false; error: string }
> {
  const form = await formFor(input.token);
  if (!form) return { ok: false, error: "That link has expired or was never ours." };
  if (!/^image\/(jpeg|png|webp)$/.test(input.type)) return { ok: false, error: "That isn't a photo we can open. Try a JPEG or PNG." };
  if (!(input.size > 0)) return { ok: false, error: "Choose a photo first." };
  if (input.size > MAX_PHOTO_BYTES) return { ok: false, error: "That photo is too big. Try a smaller one." };
  const full = roomFor(form.answers, input.area);
  if (full) return { ok: false, error: full };

  const ext = input.type === "image/png" ? "png" : input.type === "image/webp" ? "webp" : "jpg";
  const path = `${form.jobId}/intake-${crypto.randomUUID()}.${ext}`;
  const { data, error } = await form.admin.storage.from("job-photos").createSignedUploadUrl(path);
  if (error || !data) {
    log.error("intake.photo_slot_failed", { jobId: form.jobId, error: error?.message });
    return { ok: false, error: "Couldn't get that photo ready to send. Try again in a moment." };
  }
  return { ok: true, path, uploadToken: data.token };
}

/** The uploaded photo, kept with the form. */
export async function finishIntakePhoto(input: { token: string; area: string; path: string }): Promise<PhotoResult> {
  const form = await formFor(input.token);
  if (!form) return { ok: false, error: "That link has expired or was never ours." };
  const path = input.path;
  const area = input.area;
  if (!new RegExp(`^${form.jobId}/intake-[0-9a-f-]{36}\\.(jpg|png|webp)$`).test(path)) return { ok: false, error: "That photo isn't from this form." };
  if (form.answers.photos.includes(path)) {
    const { data: signed } = await form.admin.storage.from("job-photos").createSignedUrl(path, 60 * 60);
    return { ok: true, path, url: signed?.signedUrl ?? "" };
  }
  const full = roomFor(form.answers, area);
  if (full) {
    await form.admin.storage.from("job-photos").remove([path]);
    return { ok: false, error: full };
  }
  // It has to be there: a signed link only comes back for a file that exists.
  const { data: signed } = await form.admin.storage.from("job-photos").createSignedUrl(path, 60 * 60);
  if (!signed?.signedUrl) return { ok: false, error: "Couldn't upload that photo. Check your signal and try again." };

  const answers = { ...form.answers, photos: [...form.answers.photos, path], photo_areas: { ...form.answers.photo_areas, [path]: area } };
  const { error } = await form.admin.from("evaluation_intakes").update({ answers, updated_at: new Date().toISOString() }).eq("id", form.id);
  if (error) {
    await form.admin.storage.from("job-photos").remove([path]);
    return { ok: false, error: "Couldn't save that photo. Try again in a moment." };
  }
  revalidatePath(`/jobs/${form.jobId}`);
  return { ok: true, path, url: signed.signedUrl };
}

/** Takes one of their photos back off the form, and out of storage. */
export async function removeIntakePhoto(input: { token: string; path: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const form = await formFor(input.token);
  if (!form) return { ok: false, error: "That link has expired or was never ours." };
  if (!form.answers.photos.includes(input.path)) return { ok: true };
  const { [input.path]: _removed, ...photo_areas } = form.answers.photo_areas;
  void _removed;
  const answers = { ...form.answers, photos: form.answers.photos.filter((p) => p !== input.path), photo_areas };
  const { error } = await form.admin.from("evaluation_intakes").update({ answers, updated_at: new Date().toISOString() }).eq("id", form.id);
  if (error) return { ok: false, error: "Couldn't remove that photo. Try again in a moment." };
  await form.admin.storage.from("job-photos").remove([input.path]);
  revalidatePath(`/jobs/${form.jobId}`);
  return { ok: true };
}

/**
 * The answers so far, kept as they go, one question at a time. Does not
 * mark the form sent: that is Send's job. Half a form is still worth having
 * if they close it partway, so nothing waits for the end to be saved.
 */
export async function saveIntakeProgress(input: { token: string; answers: unknown }): Promise<{ ok: boolean }> {
  const form = await formFor(input.token);
  if (!form) return { ok: false };
  const answers = { ...cleanAnswers(input.answers), photos: form.answers.photos, photo_areas: form.answers.photo_areas };
  const { error } = await form.admin.from("evaluation_intakes").update({ answers, updated_at: new Date().toISOString() }).eq("id", form.id);
  return { ok: !error };
}
