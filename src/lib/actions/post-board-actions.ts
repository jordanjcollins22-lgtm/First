"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { getAgentSettings, getSeen, setPicked } from "@/lib/data/outreach-agent";
import { answeredToday, answersToPost } from "@/lib/data/post-board";
import { mentionComment } from "@/lib/outreach-agent";
import { whyNotTake } from "@/lib/post-board";
import { readAndDraft, recordOutreach, saveComment } from "@/lib/actions/outreach-link-actions";
import { finishComment, LINK_MARKER, looksUsable } from "@/lib/comment-prompt";
import { createClient } from "@/lib/supabase/server";

/**
 * Answering a post off the board.
 *
 * Whoever takes a post gets a comment written for them: in their own
 * voice, with their own tracked link, so a booking that comes of it lands
 * against them. They post it from their own Facebook account and say so
 * here. Nothing here touches Facebook.
 */

type Result = { ok: true } | { ok: false; error: string };
export type TakeResult = { ok: true; answerId: string; comment: string } | { ok: false; error: string };

function refresh() {
  revalidatePath("/admin/outreach/posts");
  revalidatePath("/my-day");
}

/**
 * Take a post and get the comment for it.
 *
 * Taking it holds one of the post's two places for a couple of hours, so a
 * third person does not pile on meanwhile. The owner is never turned away,
 * by a full post or by the day's limit. Somebody who takes a post they took
 * before gets the comment they already had back, rather than a second link.
 */
export async function takePost(seenId: string): Promise<TakeResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  const org = profile.organization_id;

  const row = await getSeen(org, seenId);
  if (!row || row.decision !== "read") return { ok: false, error: "That post isn't on the board any more." };
  if (!row.text) return { ok: false, error: "There are no words on that post to answer." };

  const now = new Date();
  const [answers, today, settings] = await Promise.all([answersToPost(org, seenId), answeredToday(org, profile.id, now), getAgentSettings(org)]);
  const refusal = whyNotTake({
    answers,
    profileId: profile.id,
    now,
    answeredToday: today,
    dailyLimit: settings.dailyCap,
    override: isOwnerLevel(profile.roles),
  });
  if (refusal) return { ok: false, error: refusal };

  const supabase = await createClient();
  const mine = answers.find((a) => a.profileId === profile.id);
  if (mine?.comment) {
    const { error } = await supabase
      .from("outreach_post_answers")
      .update({ status: mine.status === "posted" ? "posted" : "written", updated_at: now.toISOString() })
      .eq("id", mine.id);
    if (error) return { ok: false, error: error.message };
    refresh();
    return { ok: true, answerId: mine.id, comment: mine.comment };
  }

  // Held before the words are written: writing takes a few seconds, and two
  // people pressing at once should not both come away with a comment.
  const { data: held, error: holdError } = await supabase
    .from("outreach_post_answers")
    .upsert(
      { organization_id: org, seen_post_id: seenId, profile_id: profile.id, status: "written", updated_at: now.toISOString() },
      { onConflict: "seen_post_id,profile_id" }
    )
    .select("id")
    .single();
  if (holdError || !held) return { ok: false, error: holdError?.message ?? "Couldn't take that one. Try again." };

  const letGo = async (error: string): Promise<TakeResult> => {
    await supabase.from("outreach_post_answers").update({ status: "let_go", updated_at: new Date().toISOString() }).eq("id", held.id);
    return { ok: false, error };
  };

  const read = await readAndDraft({ screenshotPath: null, pastedText: row.text, kind: "comment" });
  if (!read.ok) return letGo(read.error);
  if (!read.draft) return letGo(read.draftNote ?? "Couldn't write one for that post. Try again.");

  const askedBy = row.author ?? read.askedBy ?? null;
  const recorded = await recordOutreach({
    kind: "comment",
    platform: "facebook",
    audience: row.group_name || read.groupName || "",
    fromPage: "",
    sentTo: askedBy ?? "",
    service: read.service ?? "",
    note: read.note,
    screenshotPath: null,
  });
  if (!recorded.ok) return letGo(recorded.error);

  const written = finishComment(read.draft.replace(LINK_MARKER, recorded.link), recorded.link);
  if (!looksUsable(written, recorded.link)) return letGo("The comment came back too thin. Try again.");
  const { text: comment } = mentionComment(written, askedBy);

  await Promise.all([
    saveComment({ id: recorded.id, comment }),
    supabase.from("outreach_links").update({ via: "board", post_url: row.url || null }).eq("id", recorded.id),
    supabase
      .from("outreach_post_answers")
      .update({ link_id: recorded.id, comment, updated_at: new Date().toISOString() })
      .eq("id", held.id),
  ]);
  refresh();
  return { ok: true, answerId: held.id, comment };
}

/** They posted it. The post is theirs for good, and the link counts from here. */
export async function markAnswerPosted(answerId: string): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();
  const { data: answer } = await supabase
    .from("outreach_post_answers")
    .select("id, profile_id, link_id, comment")
    .eq("organization_id", profile.organization_id)
    .eq("id", answerId)
    .maybeSingle();
  if (!answer || answer.profile_id !== profile.id) return { ok: false, error: "That isn't one of yours." };

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("outreach_post_answers")
    .update({ status: "posted", posted_at: now, updated_at: now })
    .eq("id", answerId);
  if (error) return { ok: false, error: error.message };
  if (answer.link_id) {
    await supabase.from("outreach_links").update({ posted_comment: answer.comment, posted_comment_at: now }).eq("id", answer.link_id);
  }
  refresh();
  return { ok: true };
}

/** Hand a post back, for somebody else to answer. */
export async function letPostGo(answerId: string): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outreach_post_answers")
    .update({ status: "let_go", updated_at: new Date().toISOString() })
    .eq("organization_id", profile.organization_id)
    .eq("id", answerId)
    .eq("profile_id", profile.id)
    .eq("status", "written")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "That one is already posted, or isn't yours." };
  refresh();
  return { ok: true };
}

/** The owner takes a post off the board: not a real lead, or not our work. */
export async function removeFromBoard(seenId: string): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!isOwnerLevel(profile.roles)) return { ok: false, error: "Only the owner can take a post off the board." };
  try {
    await setPicked(profile.organization_id, seenId, "declined", { decision: "declined", reason: "Taken off the board." });
  } catch (err) {
    console.error("remove from board failed:", err);
    return { ok: false, error: "Couldn't save that. Try again." };
  }
  refresh();
  revalidatePath("/admin/outreach/agent");
  return { ok: true };
}
