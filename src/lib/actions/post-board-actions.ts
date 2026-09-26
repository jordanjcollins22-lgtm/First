"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { getAgentSettings, getSeen, setPicked } from "@/lib/data/outreach-agent";
import { answeredToday, answersToPost } from "@/lib/data/post-board";
import { mentionComment } from "@/lib/outreach-agent";
import { isPostLink, whyNotTake } from "@/lib/post-board";
import { readAndDraft, recordOutreach, saveComment } from "@/lib/actions/outreach-link-actions";
import { finishComment, LINK_MARKER, looksUsable } from "@/lib/comment-prompt";
import { createClient } from "@/lib/supabase/server";
import { setPostKind } from "@/lib/data/post-sorter";
import { activeServiceNames, readPostFromScreenshot } from "@/lib/data/read-post";
import { CANT_RESPOND_REASONS, standingFor, type CantRespondReason } from "@/lib/post-board";
import { cleanLink, platformOfLink, postKeyForLink, postedAtFromAge, PLATFORM_LABEL } from "@/lib/social-finder";

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
  if (!isPostLink(row.url) && !row.screenshot_path) {
    return { ok: false, error: "That post has no working link yet, so it can't be answered from here." };
  }

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

  // A post somebody added from a screenshot is written from the picture:
  // the words kept for it are a summary, and the picture is the post.
  const read = await readAndDraft({ screenshotPath: row.screenshot_path ?? null, pastedText: row.text, kind: "comment" });
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

/**
 * Somebody can't respond to a post, and says why.
 *
 * It leaves the board for everybody: an ad's business goes on the
 * Businesses list, anything else is set aside as not a job post. The reason
 * is kept on the post, with who gave it.
 */
export async function markCantRespond(seenId: string, reason: CantRespondReason, note?: string): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  const picked = CANT_RESPOND_REASONS.find((r) => r.key === reason);
  if (!picked) return { ok: false, error: "Pick a reason." };
  const result = await setPostKind(profile.organization_id, seenId, picked.kind);
  if (!result.ok) return { ok: false, error: result.error ?? "Couldn't save that." };
  const who = (profile.full_name || profile.email || "somebody").split(" ")[0];
  const said = [picked.label, note?.trim().slice(0, 200)].filter(Boolean).join(": ");
  const supabase = await createClient();
  await supabase
    .from("outreach_seen_posts")
    .update({ reason: `${said} (${who})` })
    .eq("organization_id", profile.organization_id)
    .eq("id", seenId);
  refresh();
  revalidatePath("/admin/outreach/agent");
  return { ok: true };
}

export type FoundResult =
  | { ok: true; status: "added"; seenId: string; message: string }
  | { ok: true; status: "already"; seenId: string | null; message: string; canAnswer: boolean }
  | { ok: false; error: string };

/**
 * Somebody found a post the finder missed: a link, a screenshot, or both.
 *
 * Checked first against everything already kept -- the post's key, its
 * link, and the screenshot's fingerprint -- and the person told what became
 * of it if it is in: on the board, answered by whom, or set aside as an ad.
 * If it is new it is kept as a post asking for work, since a person looked
 * at it and said so, and it comes up next on their card.
 */
export async function submitFoundPost(input: {
  url: string;
  screenshotPath?: string | null;
  screenshotHash?: string | null;
  words?: string;
}): Promise<FoundResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  const org = profile.organization_id;

  const url = input.url.trim() ? cleanLink(input.url) : null;
  if (input.url.trim() && !url) return { ok: false, error: "That doesn't look like a link. Use Share → Copy link on the post." };
  if (url && !isPostLink(url)) {
    return { ok: false, error: "That link doesn't open a post. On the post, press Share → Copy link, and paste that." };
  }
  if (!url && !input.screenshotPath) return { ok: false, error: "Paste the post's link, add a screenshot, or both." };
  const hash = input.screenshotHash && /^[a-f0-9]{64}$/i.test(input.screenshotHash) ? input.screenshotHash.toLowerCase() : null;

  const supabase = await createClient();
  const key = url ? postKeyForLink(url) : null;
  const checks = [
    key ? supabase.from("outreach_seen_posts").select("id, kind, decision").eq("organization_id", org).eq("post_key", key).limit(1) : null,
    url ? supabase.from("outreach_seen_posts").select("id, kind, decision").eq("organization_id", org).eq("url", url).limit(1) : null,
    hash ? supabase.from("outreach_seen_posts").select("id, kind, decision").eq("organization_id", org).eq("screenshot_hash", hash).limit(1) : null,
  ];
  for (const check of checks) {
    if (!check) continue;
    const { data } = await check;
    const found = data?.[0];
    if (found) return { ok: true, status: "already", seenId: found.id, ...(await describeKept(org, profile.id, found)) };
  }

  // Read the picture for who posted it, where, and what they want.
  let reading: Awaited<ReturnType<typeof readPostFromScreenshot>> = null;
  if (input.screenshotPath) {
    const services = await activeServiceNames(org).catch(() => []);
    reading = await readPostFromScreenshot({
      screenshotPath: input.screenshotPath,
      pastedText: input.words ?? "",
      note: "",
      groupName: "",
      services,
      blockWords: [],
    }).catch(() => null);
  }
  const words = (input.words ?? "").trim();
  const text = words || reading?.summary || "";
  if (!text && !input.screenshotPath) {
    return { ok: false, error: "Add a screenshot, or type what they asked for, so the comment can be written." };
  }

  const now = new Date();
  const platform = url ? platformOfLink(url) : reading?.platform === "nextdoor" ? "nextdoor" : "facebook";
  const who = profile.full_name || profile.email || "somebody on the team";
  const { data: row, error } = await supabase
    .from("outreach_seen_posts")
    .insert({
      organization_id: org,
      post_key: key ?? `shot:${hash ?? crypto.randomUUID()}`,
      url: url ?? "",
      group_name: reading?.groupName ?? null,
      author: reading?.author ?? null,
      text: text || "Added from a screenshot.",
      age_days: reading?.ageDays ?? null,
      posted_at: postedAtFromAge(reading?.ageDays ?? null, now)?.toISOString() ?? null,
      decision: "read",
      kind: "request",
      kind_by: "owner",
      source: "group",
      platform,
      match_reason: `Added by ${who.split(" ")[0]}`,
      screenshot_path: input.screenshotPath ?? null,
      screenshot_hash: hash,
      added_by: profile.id,
      seen_by: profile.id,
    })
    .select("id")
    .single();
  if (error || !row) {
    if (error && /duplicate|unique/i.test(error.message)) return { ok: true, status: "already", seenId: null, message: "Somebody added this one a moment ago.", canAnswer: false };
    return { ok: false, error: error?.message ?? "Couldn't add that." };
  }
  refresh();
  return {
    ok: true,
    status: "added",
    seenId: row.id,
    message: url ? `Added from ${PLATFORM_LABEL[platform]}. It's up next.` : "Added. It's up next. It has no link, so find the post yourself to comment.",
  };
}

/** What became of a post that was already kept, in a sentence. */
async function describeKept(
  org: string,
  profileId: string,
  row: { id: string; kind: string | null; decision: string }
): Promise<{ message: string; canAnswer: boolean }> {
  if (row.kind === "promotion" || row.decision === "advert") return { message: "Already in: it was marked as an ad.", canAnswer: false };
  if (row.kind === "other") return { message: "Already in: it was marked as not a job post.", canAnswer: false };
  if (row.decision === "declined") return { message: "Already in: it was taken off the board.", canAnswer: false };
  const answers = await answersToPost(org, row.id);
  const standing = standingFor(answers, profileId, new Date());
  if (standing.pile === "mine") return { message: "Already in, and it's yours: it's up next.", canAnswer: true };
  const names = standing.others.map((a) => `${a.name}${a.status === "posted" ? " answered it" : " is answering it"}`).join(", ");
  if (standing.pile === "full") return { message: `Already in: ${names}.`, canAnswer: false };
  return { message: names ? `Already in: ${names}. There's room for yours; it's up next.` : "Already in and nobody has answered it yet. It's up next.", canAnswer: true };
}
