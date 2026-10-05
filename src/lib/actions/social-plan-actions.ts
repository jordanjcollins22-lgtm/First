"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { refuseInDemo } from "@/lib/demo-mode";
import { isOwnerLevel } from "@/lib/roles";
import { outboundBaseUrl } from "@/lib/base-url";
import { trackedLink } from "@/lib/outreach-links";
import { cleanHashtags, composePlanCaption, planProblems, planSlot, type PlanText } from "@/lib/social-plan";

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
    .select("id, status, plan_day, link:outreach_links(code)")
    .eq("id", id)
    .maybeSingle();
  if (!post?.plan_day) return { ok: false, message: "Couldn't find that post." };
  if (post.status === "posted") return { ok: false, message: "That one has already gone out." };
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
