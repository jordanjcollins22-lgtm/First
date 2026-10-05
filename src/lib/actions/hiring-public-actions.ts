"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { APPLICANT_TOKEN, careersOrg } from "@/lib/data/hiring";
import { positionFor } from "@/lib/hiring/positions";
import { cleanAnswers, cleanContact, missing, screen } from "@/lib/hiring/screening";
import { log, maskEmail } from "@/lib/log";

/**
 * The applicant's side of hiring: apply, then send a video.
 *
 * Runs as the service role because the applicant has no account. Applying
 * can only add an application; the token it hands back names that one
 * application, and the only thing it can do is attach a video to it.
 */

export type ApplyResult =
  | { ok: true; passed: true; token: string }
  | { ok: true; passed: false }
  | { ok: false; error: string; missing?: string[] };

function newToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function applyForPosition(input: {
  org: string | null;
  position: string;
  contact: unknown;
  answers: unknown;
  source: string | null;
  /** A field people can't see. Anything in it was filled in by a bot. */
  website?: string;
}): Promise<ApplyResult> {
  const position = positionFor(input.position);
  if (!position) return { ok: false, error: "That job isn't open." };
  // A bot fills in every box. Told it worked, so it doesn't try again.
  if (input.website) return { ok: true, passed: false };

  const contact = cleanContact(input.contact);
  const answers = cleanAnswers(position, input.answers);
  const gaps = missing(position, contact, answers);
  if (gaps.length > 0) return { ok: false, error: "A few answers are missing.", missing: gaps };

  const org = await careersOrg(input.org);
  if (!org) return { ok: false, error: "That link isn't one of ours." };

  const result = screen(position, answers);
  const admin = createAdminClient();

  // Applied for this job already: the same application, not a second one. A
  // passed applicant gets their video link back.
  const { data: earlier } = await admin
    .from("job_applicants")
    .select("id, token, stage")
    .eq("organization_id", org.id)
    .eq("position", position.key)
    .ilike("email", contact.email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (earlier) {
    if (earlier.stage === "screened_out" || earlier.stage === "not_a_fit" || earlier.stage === "withdrawn") return { ok: true, passed: false };
    return { ok: true, passed: true, token: earlier.token };
  }

  const token = newToken();
  const source = input.source ? input.source.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || null : null;
  const { data: row, error } = await admin
    .from("job_applicants")
    .insert({
      organization_id: org.id,
      position: position.key,
      token,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      zip: contact.zip,
      answers,
      screen_reasons: result.reasons,
      stage: result.passed ? "video_requested" : "screened_out",
      source,
    })
    .select("id")
    .single();
  if (error || !row) {
    log.error("hiring.apply_failed", { position: position.key, error: error?.message });
    return { ok: false, error: "We couldn't send that. Try again in a moment." };
  }
  await admin.from("applicant_events").insert({
    applicant_id: row.id,
    kind: "applied",
    detail: { passed: result.passed, reasons: result.reasons, source },
  });
  log.info("hiring.applied", { position: position.key, passed: result.passed, email: maskEmail(contact.email), source });
  revalidatePath("/admin/hiring");
  return result.passed ? { ok: true, passed: true, token } : { ok: true, passed: false };
}

/**
 * The storage's own cap on one upload (the project setting, 50 MB), so a
 * video over it is turned away before it is sent rather than after. The
 * page records at a bitrate that keeps a couple of minutes well under it;
 * a full-quality phone recording can be bigger and goes as a link.
 */
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/3gpp": "3gp",
  "video/x-m4v": "m4v",
};

async function applicantFor(token: string) {
  if (!APPLICANT_TOKEN.test(token)) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("job_applicants").select("id, stage").eq("token", token).maybeSingle();
  return data ? { admin, id: data.id, stage: data.stage } : null;
}

const CLOSED = "This application is closed. If that's a surprise, reply to our email.";

/**
 * A place in storage for the video, which the phone uploads to directly. A
 * video is far too big to pass through a server action.
 */
export async function startApplicantVideo(input: { token: string; type: string; size: number }): Promise<
  { ok: true; path: string; uploadToken: string } | { ok: false; error: string }
> {
  const applicant = await applicantFor(input.token);
  if (!applicant) return { ok: false, error: "That link has expired or was never ours." };
  if (applicant.stage !== "video_requested" && applicant.stage !== "video_submitted") return { ok: false, error: CLOSED };
  const ext = VIDEO_TYPES[input.type.split(";")[0].trim().toLowerCase()];
  if (!ext) return { ok: false, error: "That isn't a video we can play. Try an MP4 or a video from your phone's camera." };
  if (!(input.size > 0)) return { ok: false, error: "Choose a video first." };
  if (input.size > MAX_VIDEO_BYTES) return { ok: false, error: "too_big" };

  const path = `${applicant.id}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await applicant.admin.storage.from("applicant-videos").createSignedUploadUrl(path);
  if (error || !data) {
    log.error("hiring.video_slot_failed", { applicantId: applicant.id, error: error?.message });
    return { ok: false, error: "Couldn't get ready for your video. Try again in a moment." };
  }
  return { ok: true, path, uploadToken: data.token };
}

/** The uploaded video, kept with the application and sent for review. */
export async function finishApplicantVideo(input: { token: string; path: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const applicant = await applicantFor(input.token);
  if (!applicant) return { ok: false, error: "That link has expired or was never ours." };
  if (!new RegExp(`^${applicant.id}/[0-9a-f-]{36}\\.(mp4|mov|webm|3gp|m4v)$`).test(input.path)) {
    return { ok: false, error: "That video isn't from this application." };
  }
  // It has to be there: a signed link only comes back for a file that exists.
  const { data: signed } = await applicant.admin.storage.from("applicant-videos").createSignedUrl(input.path, 60);
  if (!signed?.signedUrl) return { ok: false, error: "Your video didn't finish uploading. Check your signal and try again." };
  return markVideoIn(applicant, { video_path: input.path, video_link: null });
}

/** A video too big to upload, sent as a link instead (Google Drive, YouTube unlisted, iCloud). */
export async function submitApplicantVideoLink(input: { token: string; link: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const applicant = await applicantFor(input.token);
  if (!applicant) return { ok: false, error: "That link has expired or was never ours." };
  let url: URL;
  try {
    url = new URL(input.link.trim());
  } catch {
    return { ok: false, error: "That doesn't look like a link. Copy the whole thing, starting with https://" };
  }
  if (url.protocol !== "https:") return { ok: false, error: "Use the https:// link to your video." };
  return markVideoIn(applicant, { video_path: null, video_link: url.toString().slice(0, 500) });
}

async function markVideoIn(
  applicant: NonNullable<Awaited<ReturnType<typeof applicantFor>>>,
  video: { video_path: string | null; video_link: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (applicant.stage !== "video_requested" && applicant.stage !== "video_submitted") return { ok: false, error: CLOSED };
  const now = new Date().toISOString();
  const { error } = await applicant.admin
    .from("job_applicants")
    .update({ ...video, stage: "video_submitted", video_submitted_at: now, updated_at: now })
    .eq("id", applicant.id);
  if (error) return { ok: false, error: "Couldn't save your video. Try again in a moment." };
  await applicant.admin.from("applicant_events").insert({
    applicant_id: applicant.id,
    kind: "video_submitted",
    detail: video.video_link ? { link: true } : { upload: true },
  });
  log.info("hiring.video_in", { applicantId: applicant.id, link: Boolean(video.video_link) });
  revalidatePath("/admin/hiring");
  return { ok: true };
}
