"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { refuseInDemo } from "@/lib/demo-mode";
import { isOwnerLevel } from "@/lib/roles";
import { isMissingColumn, isMissingTable } from "@/lib/setup-errors";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { outboundBaseUrl } from "@/lib/base-url";
import { localDay } from "@/lib/marketing/social-autopost";
import { loadCadence } from "@/lib/data/social-autopost";
import { loadBookings, makeBacklogDraft } from "@/lib/data/social-photo-drafts";
import { writeDraftText } from "@/lib/social/photo-post-writer";
import { approvalSlot, draftCaption, draftProblems } from "@/lib/social/photo-drafts";
import { cleanHashtags } from "@/lib/social-plan";
import { shortWhen } from "@/lib/time-zone";

export type BacklogResult = { ok: true; message: string; path?: string; token?: string } | { ok: false; message: string };

const NEEDS_MIGRATION = "Apply migration 0376_social_photo_backlog.sql first (Admin › Database).";
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

async function owner(): Promise<{ id: string; organizationId: string } | { refused: string }> {
  await refuseInDemo();
  const profile = await getCurrentProfile();
  if (!profile) return { refused: "Sign in first." };
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin")) return { refused: "Only an owner or admin can add photos and approve posts." };
  return { id: profile.id, organizationId: profile.organization_id };
}

function revalidate() {
  revalidatePath("/admin/social");
  revalidatePath("/marketing");
  revalidatePath("/my-day");
}

/**
 * Room in the job-photos bucket for one backlog photo, under
 * backlog/<organization>/. The phone uploads straight to it, so a big photo
 * never goes through a server action.
 */
export async function backlogUploadSlot(type: string, size: number): Promise<BacklogResult> {
  const who = await owner();
  if ("refused" in who) return { ok: false, message: who.refused };
  if (!isSupabaseAdminConfigured) return { ok: false, message: "Photo uploads aren't set up on this site." };
  if (!/^image\/(jpeg|png|webp)$/.test(type)) return { ok: false, message: "That isn't a photo we can use. Try a JPEG or PNG." };
  if (!(size > 0) || size > MAX_PHOTO_BYTES) return { ok: false, message: "That photo is too big. Try a smaller one." };
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const path = `backlog/${who.organizationId}/${randomUUID()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from("job-photos").createSignedUploadUrl(path);
  if (error || !data) return { ok: false, message: "Couldn't make room for the photo. Try again." };
  return { ok: true, message: "Ready.", path, token: data.token };
}

/**
 * A photo now in storage, into the backlog and straight into a draft post:
 * caption written (the AI writer when it is set up, the template when not),
 * a suggested time, waiting in "Ready to approve".
 */
export async function addBacklogPhoto(input: { path: string; town?: string | null; service?: string | null; note?: string | null }): Promise<BacklogResult> {
  const who = await owner();
  if ("refused" in who) return { ok: false, message: who.refused };
  if (!input.path.startsWith(`backlog/${who.organizationId}/`)) return { ok: false, message: "That photo isn't in this business's backlog." };
  const clip = (s: string | null | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n) || null;
  const sb = (await createClient()) as unknown as SupabaseClient;
  const { data: row, error } = await sb
    .from("social_photo_backlog")
    .insert({
      organization_id: who.organizationId,
      path: input.path,
      town: clip(input.town, 60),
      service: clip(input.service, 60),
      note: clip(input.note, 280),
      uploaded_by: who.id,
    })
    .select("id, town, service, note")
    .single();
  if (isMissingTable(error) || isMissingColumn(error)) return { ok: false, message: NEEDS_MIGRATION };
  if (error || !row) return { ok: false, message: "Couldn't save that photo. Try again." };

  const bookingUrl = `${(await outboundBaseUrl()).replace(/\/$/, "")}/book`;
  const made = await makeBacklogDraft(sb, who.organizationId, row as { id: string; town: string | null; service: string | null; note: string | null }, {
    bookingUrl,
    writer: writeDraftText,
  });
  revalidate();
  if ("error" in made) {
    if (/backlog_photo_id/.test(made.error)) return { ok: false, message: NEEDS_MIGRATION };
    return { ok: false, message: "Saved to the backlog, but the draft couldn't be made. Try again." };
  }
  return { ok: true, message: "Draft made. It's in Ready to approve." };
}

/**
 * Approve a draft from "Ready to approve": the edits are kept, the caption
 * is checked (town only, no price, no licence claim, no client or street),
 * and it takes its suggested time if that is still ahead and free, or the
 * next free slot on the cadence. The posting job sends it then.
 */
export async function approveQueuedPost(id: string, edits: { hook: string; body: string }): Promise<BacklogResult> {
  const who = await owner();
  if ("refused" in who) return { ok: false, message: who.refused };
  const sb = (await createClient()) as unknown as SupabaseClient;
  const read = (cols: string) => sb.from("social_posts").select(cols).eq("id", id).eq("organization_id", who.organizationId).maybeSingle();
  let { data, error } = await read("id, status, cta, hashtags, scheduled_for, plan_day, platforms");
  if (isMissingColumn(error)) ({ data, error } = await read("id, status, cta, hashtags, scheduled_for, plan_day"));
  const post = data as unknown as { status: string; cta: string | null; hashtags: string[] | null; scheduled_for: string | null; platforms?: string[] | null } | null;
  if (error || !post) return { ok: false, message: "Couldn't find that post." };
  if (post.status !== "draft") return { ok: false, message: "That one isn't waiting for approval any more." };

  const text = { hook: edits.hook.trim(), body: edits.body.trim(), cta: (post.cta ?? "").trim(), hashtags: cleanHashtags(post.hashtags ?? []) };
  const problems = draftProblems(text);
  if (problems.length) return { ok: false, message: problems.join(" ") };

  const now = new Date();
  const platforms = post.platforms?.length ? post.platforms : ["facebook", "instagram"];
  const [cadenceRow, booked] = await Promise.all([
    loadCadence(sb, who.organizationId),
    loadBookings(sb, who.organizationId, now, id, ["scheduled", "posted"]),
  ]);
  const slot = approvalSlot({ cadence: cadenceRow.cadence, suggested: post.scheduled_for, booked, platforms, now });
  const at = now.toISOString();
  const { error: saveError } = await sb
    .from("social_posts")
    .update({
      hook: text.hook,
      body: text.body,
      caption: draftCaption(text),
      // No free slot on the cadence: approved, and the posting job gives it one.
      status: slot ? "scheduled" : "approved",
      scheduled_for: slot ? slot.toISOString() : null,
      ...(slot ? { plan_day: localDay(slot) } : {}),
      approved_by: who.id,
      approved_at: at,
      updated_at: at,
    })
    .eq("id", id)
    .eq("status", "draft");
  if (saveError) return { ok: false, message: "Couldn't approve. Try again." };
  revalidate();
  return { ok: true, message: slot ? `Approved. Goes out ${shortWhen(slot)}.` : "Approved. It gets the next free slot." };
}

/** Keep caption edits on a draft without approving it. */
export async function saveQueuedPost(id: string, edits: { hook: string; body: string }): Promise<BacklogResult> {
  const who = await owner();
  if ("refused" in who) return { ok: false, message: who.refused };
  const sb = await createClient();
  const { error } = await sb
    .from("social_posts")
    .update({ hook: edits.hook.trim(), body: edits.body.trim(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", who.organizationId)
    .eq("status", "draft");
  if (error) return { ok: false, message: "Couldn't save. Try again." };
  revalidate();
  return { ok: true, message: "Saved." };
}
