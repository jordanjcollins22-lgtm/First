"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { answeredCount, cleanAnswers, MAX_INTAKE_PHOTOS } from "@/lib/evaluation-intake";
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

  const answers = { ...cleanAnswers(input.answers), photos: form.answers.photos };
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

/**
 * One photo of the property, kept with the form the moment it is added, so
 * it is not lost if they never press Send. Shrunk on the phone first; the
 * size check here catches anything that skipped that.
 */
export async function addIntakePhoto(formData: FormData): Promise<PhotoResult> {
  const form = await formFor(String(formData.get("token") ?? ""));
  if (!form) return { ok: false, error: "That link has expired or was never ours." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a photo first." };
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return { ok: false, error: "That isn't a photo we can open. Try a JPEG or PNG." };
  if (file.size > 950 * 1024) return { ok: false, error: "That photo is too big. Try again, or a smaller one." };
  if (form.answers.photos.length >= MAX_INTAKE_PHOTOS) return { ok: false, error: `${MAX_INTAKE_PHOTOS} photos is plenty. Remove one to add another.` };

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${form.jobId}/intake-${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await form.admin.storage
    .from("job-photos")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (uploadError) return { ok: false, error: "Couldn't upload that photo. Check your signal and try again." };

  const answers = { ...form.answers, photos: [...form.answers.photos, path] };
  const { error } = await form.admin.from("evaluation_intakes").update({ answers, updated_at: new Date().toISOString() }).eq("id", form.id);
  if (error) {
    await form.admin.storage.from("job-photos").remove([path]);
    return { ok: false, error: "Couldn't save that photo. Try again in a moment." };
  }
  const { data: signed } = await form.admin.storage.from("job-photos").createSignedUrl(path, 60 * 60);
  revalidatePath(`/jobs/${form.jobId}`);
  return { ok: true, path, url: signed?.signedUrl ?? "" };
}

/** Takes one of their photos back off the form, and out of storage. */
export async function removeIntakePhoto(input: { token: string; path: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const form = await formFor(input.token);
  if (!form) return { ok: false, error: "That link has expired or was never ours." };
  if (!form.answers.photos.includes(input.path)) return { ok: true };
  const answers = { ...form.answers, photos: form.answers.photos.filter((p) => p !== input.path) };
  const { error } = await form.admin.from("evaluation_intakes").update({ answers, updated_at: new Date().toISOString() }).eq("id", form.id);
  if (error) return { ok: false, error: "Couldn't remove that photo. Try again in a moment." };
  await form.admin.storage.from("job-photos").remove([input.path]);
  revalidatePath(`/jobs/${form.jobId}`);
  return { ok: true };
}
