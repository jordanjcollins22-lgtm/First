"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { refuseInDemo } from "@/lib/demo-mode";
import { isOwnerLevel } from "@/lib/roles";
import { outboundBaseUrl } from "@/lib/base-url";
import { trackedLink } from "@/lib/outreach-links";
import { cleanHashtags, composePlanCaption, planProblems, planSlot, type CardStyle, type PlanText } from "@/lib/social-plan";
import { tidyCrop, type Crop } from "@/lib/social-crop";
import { tidyLayout, type Layout } from "@/lib/social-layout";

export type PlanResult = { ok: true; message: string } | { ok: false; message: string };

async function owner(): Promise<{ id: string } | { refused: string }> {
  await refuseInDemo();
  const profile = await getCurrentProfile();
  if (!profile) return { refused: "Sign in first." };
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin")) return { refused: "Only an owner or admin can approve posts." };
  return { id: profile.id };
}

function tidy(text: PlanText): PlanText {
  return { hook: text.hook.trim(), body: text.body.trim(), cta: text.cta.trim(), hashtags: cleanHashtags(text.hashtags) };
}

function revalidate() {
  revalidatePath("/marketing");
  revalidatePath("/admin/social");
  revalidatePath("/my-day");
}

/** Keep the edits without approving. */
export async function savePlanPost(id: string, text: PlanText): Promise<PlanResult> {
  const who = await owner();
  if ("refused" in who) return { ok: false, message: who.refused };
  const t = tidy(text);
  const supabase = await createClient();
  const { error } = await supabase
    .from("social_posts")
    .update({ hook: t.hook, body: t.body, cta: t.cta, hashtags: t.hashtags, updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["draft", "scheduled"]);
  if (error) return { ok: false, message: "Couldn't save. Try again." };
  revalidate();
  return { ok: true, message: "Saved." };
}

/**
 * Approve it: the caption is put together with its tracked link, and it is
 * given its day's posting time, or the next run if that has passed.
 */
export async function approvePlanPost(id: string, text: PlanText): Promise<PlanResult> {
  const who = await owner();
  if ("refused" in who) return { ok: false, message: who.refused };
  const t = tidy(text);
  const problems = planProblems(t);
  if (problems.length) return { ok: false, message: problems.join(" ") };
  const supabase = await createClient();
  const { data: post } = await supabase
    .from("social_posts")
    .select("id, status, plan_day, placement, link:outreach_links(code)")
    .eq("id", id)
    .maybeSingle();
  if (!post?.plan_day) return { ok: false, message: "Couldn't find that post." };
  if (post.status === "posted") return { ok: false, message: "That one has already gone out." };
  // Nothing can publish to a group, so a group post is never scheduled for
  // the page; it is copied, posted by hand and marked posted.
  if (post.placement === "group") return { ok: false, message: "Group posts go up by hand. Copy it, post it, then press Mark as posted." };
  const link = (Array.isArray(post.link) ? post.link[0] : post.link) as { code: string } | null;
  const url = link?.code ? trackedLink(await outboundBaseUrl(), link.code) : null;
  const now = new Date();
  const at = planSlot(post.plan_day, now);
  const { error } = await supabase
    .from("social_posts")
    .update({
      hook: t.hook,
      body: t.body,
      cta: t.cta,
      hashtags: t.hashtags,
      caption: composePlanCaption(t, url),
      status: "scheduled",
      scheduled_for: at.toISOString(),
      approved_by: who.id,
      approved_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, message: "Couldn't approve. Try again." };
  revalidate();
  return { ok: true, message: "Approved. It goes out on its day." };
}

/** A post somebody put up by hand: in local groups, or on the page themselves. */
export async function markPlanPosted(id: string, text: PlanText): Promise<PlanResult> {
  const who = await owner();
  if ("refused" in who) return { ok: false, message: who.refused };
  const t = tidy(text);
  const supabase = await createClient();
  const { data: post } = await supabase.from("social_posts").select("id, placement, link:outreach_links(code)").eq("id", id).maybeSingle();
  if (!post) return { ok: false, message: "Couldn't find that post." };
  const link = (Array.isArray(post.link) ? post.link[0] : post.link) as { code: string } | null;
  const url = link?.code ? trackedLink(await outboundBaseUrl(), link.code) : null;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("social_posts")
    .update({
      hook: t.hook,
      body: t.body,
      cta: t.cta,
      hashtags: t.hashtags,
      caption: composePlanCaption(t, url),
      status: "posted",
      posted_at: now,
      scheduled_for: null,
      channel: post.placement === "group" ? "groups-by-hand" : "page-by-hand",
      updated_at: now,
    })
    .eq("id", id)
    .in("status", ["draft", "scheduled"]);
  if (error) return { ok: false, message: "Couldn't mark it posted. Try again." };
  revalidate();
  return { ok: true, message: "Marked as posted." };
}

/** Take it out of the week. */
export async function skipPlanPost(id: string): Promise<PlanResult> {
  const who = await owner();
  if ("refused" in who) return { ok: false, message: who.refused };
  const supabase = await createClient();
  const { error } = await supabase
    .from("social_posts")
    .update({ status: "skipped", scheduled_for: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["draft", "scheduled"]);
  if (error) return { ok: false, message: "Couldn't skip it. Try again." };
  revalidate();
  return { ok: true, message: "Skipped." };
}

/** Back to waiting, for a post approved by mistake before it has gone out. */
export async function unapprovePlanPost(id: string): Promise<PlanResult> {
  const who = await owner();
  if ("refused" in who) return { ok: false, message: who.refused };
  const supabase = await createClient();
  const { error } = await supabase
    .from("social_posts")
    .update({ status: "draft", scheduled_for: null, approved_by: null, approved_at: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "scheduled");
  if (error) return { ok: false, message: "Couldn't change it. Try again." };
  revalidate();
  return { ok: true, message: "Back to waiting for approval." };
}

export interface PhotoChoice {
  id: string;
  kind: "before" | "after" | "during";
  zone: string | null;
  takenAt: string;
}

export interface PictureChoices {
  jobs: { id: string; label: string }[];
  jobId: string | null;
  photos: PhotoChoice[];
}

/** Jobs with crew photos, newest first, and the photos of one of them, by area. */
export async function getPictureChoices(jobId: string | null): Promise<PictureChoices | { error: string }> {
  const who = await owner();
  if ("refused" in who) return { error: who.refused };
  const supabase = await createClient();
  const since = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const { data: recent } = await supabase
    .from("job_photos")
    .select("job_id, created_at, jobs(properties(address))")
    .in("kind", ["before", "after", "during"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1500);
  type Recent = { job_id: string; created_at: string; jobs: { properties: { address: string | null } | null } | null };
  const jobs: { id: string; label: string }[] = [];
  for (const r of (recent ?? []) as unknown as Recent[]) {
    if (jobs.some((j) => j.id === r.job_id)) continue;
    const address = r.jobs?.properties?.address ?? "A job";
    const short = address.split(",").slice(0, 2).join(",");
    jobs.push({ id: r.job_id, label: `${short} · ${new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}` });
  }
  const pick = jobId ?? jobs[0]?.id ?? null;
  if (!pick) return { jobs, jobId: null, photos: [] };
  const { data: photos } = await supabase
    .from("job_photos")
    .select("id, kind, zone_name, created_at")
    .eq("job_id", pick)
    .in("kind", ["before", "after", "during"])
    .order("zone_name")
    .order("created_at");
  return {
    jobs,
    jobId: pick,
    photos: (photos ?? []).map((p) => ({ id: p.id, kind: p.kind as PhotoChoice["kind"], zone: p.zone_name, takenAt: p.created_at })),
  };
}

/**
 * Change a post's pictures: which photos, how they are laid out, and where
 * each sits in its space.
 */
export async function setPlanPictures(
  id: string,
  input: { jobId: string | null; cardStyle: CardStyle; beforeId: string | null; afterId: string | null; beforeCrop: Crop; afterCrop: Crop; layout: Layout }
): Promise<PlanResult> {
  const who = await owner();
  if ("refused" in who) return { ok: false, message: who.refused };
  if (input.cardStyle === "split" && (!input.beforeId || !input.afterId)) return { ok: false, message: "Pick a before and an after." };
  if (input.cardStyle === "photo" && !input.afterId) return { ok: false, message: "Pick a photo." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("social_posts")
    .update({
      job_id: input.jobId,
      card_style: input.cardStyle,
      before_photo_id: input.cardStyle === "split" ? input.beforeId : null,
      after_photo_id: input.cardStyle === "brand" ? null : input.afterId,
      before_crop: tidyCrop(input.beforeCrop),
      after_crop: tidyCrop(input.afterCrop),
      layout: tidyLayout(input.layout),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .in("status", ["draft", "scheduled"]);
  if (error) {
    if (error.code === "23505") return { ok: false, message: "That before and after pair is already used on another post." };
    return { ok: false, message: "Couldn't save the pictures. Try again." };
  }
  revalidate();
  return { ok: true, message: "Pictures saved. The new picture is drawing." };
}
