"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import {
  approveReady,
  declineReady,
  dismissGroup,
  getAgentSettings,
  getSeen,
  pauseAgent,
  saveAgentSettings,
  setGroupJoined,
  setPicked,
} from "@/lib/data/outreach-agent";
import { cleanSubreddit } from "@/lib/social-finder";
import { mentionComment, normaliseGroupUrl, type AgentGroup, type AgentSources } from "@/lib/outreach-agent";
import { readAndDraft, recordOutreach, saveComment } from "@/lib/actions/outreach-link-actions";
import { finishComment, LINK_MARKER, looksUsable } from "@/lib/comment-prompt";
import { createClient } from "@/lib/supabase/server";
import { removeBusiness, setPostKind, sortReadPosts } from "@/lib/data/post-sorter";

/**
 * The owner's hand on the group agent: which groups, how many a day, when,
 * and the stop button.
 */

type Result = { ok: true } | { ok: false; error: string };

export async function updateAgentSettings(input: {
  groups: AgentGroup[];
  sources: AgentSources;
  searchPhrases: string;
  areaWords: string;
  keywords: string;
  dailyCap: number;
  hourlyCap: number;
  activeFrom: string;
  activeTo: string;
  scanEveryMinutes: number;
  maxAgeDays: number;
  autoPost: boolean;
  pickPosts: boolean;
  redditEnabled?: boolean;
  /** One per line or comma-separated, with or without the r/. */
  redditSubreddits?: string;
}): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!isOwnerLevel(profile.roles)) return { ok: false, error: "Only the owner can change this." };

  const groups: AgentGroup[] = [];
  for (const group of input.groups) {
    const url = normaliseGroupUrl(group.url);
    if (!url) return { ok: false, error: `"${group.url}" is not a Facebook group link.` };
    if (groups.some((g) => g.url === url)) continue;
    groups.push({ url, name: group.name.trim().slice(0, 120) || url.split("/groups/")[1]?.replace(/\/$/, "") || "Group" });
  }
  const keywords = input.keywords
    .split(/[\n,]/)
    .map((word) => word.trim().toLowerCase())
    .filter((word, index, all) => word.length > 1 && all.indexOf(word) === index)
    .slice(0, 80);
  if (keywords.length === 0) return { ok: false, error: "Keep at least one keyword, or every post gets read." };
  const list = (raw: string, max: number) =>
    raw
      .split(/[\n,]/)
      .map((word) => word.trim())
      .filter((word, index, all) => word.length > 1 && all.findIndex((w) => w.toLowerCase() === word.toLowerCase()) === index)
      .slice(0, max);
  const searchPhrases = list(input.searchPhrases, 20);
  const areaWords = list(input.areaWords, 120).map((word) => word.toLowerCase());
  if (input.sources.search && searchPhrases.length === 0) return { ok: false, error: "Search is on but there is nothing to search for." };
  if (input.sources.search && areaWords.length === 0) return { ok: false, error: "Search needs at least one area word, or it answers people in other states." };

  const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!clock.test(input.activeFrom) || !clock.test(input.activeTo)) return { ok: false, error: "Hours need to look like 08:00." };

  const current = await getAgentSettings(profile.organization_id);
  let redditSubreddits = current.redditSubreddits;
  if (input.redditSubreddits !== undefined) {
    const named = input.redditSubreddits.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    const clean = named.map((s) => cleanSubreddit(s));
    const bad = named.find((_, i) => !clean[i]);
    if (bad) return { ok: false, error: `"${bad}" isn't a subreddit name.` };
    redditSubreddits = Array.from(new Set(clean as string[])).slice(0, 12);
  }
  const redditEnabled = input.redditEnabled ?? current.redditEnabled;
  if (redditEnabled && redditSubreddits.length === 0) return { ok: false, error: "Reddit is on but there are no subreddits to read." };

  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, Math.round(Number(value) || 0)));

  try {
    await saveAgentSettings(profile.organization_id, profile.id, {
      groups,
      sources: { feed: Boolean(input.sources.feed), search: Boolean(input.sources.search), list: Boolean(input.sources.list) },
      searchPhrases,
      areaWords,
      keywords,
      dailyCap: clamp(input.dailyCap, 0, 40),
      hourlyCap: clamp(input.hourlyCap, 0, 10),
      activeFrom: input.activeFrom,
      activeTo: input.activeTo,
      scanEveryMinutes: clamp(input.scanEveryMinutes, 10, 240),
      maxAgeDays: clamp(input.maxAgeDays, 0, 30),
      redditEnabled,
      redditSubreddits,
      autoPost: Boolean(input.autoPost),
      pickPosts: Boolean(input.pickPosts),
    });
  } catch (err) {
    console.error("agent settings failed to save:", err);
    return { ok: false, error: "Couldn't save that. Try again." };
  }
  revalidatePath("/admin/outreach/agent");
  return { ok: true };
}

/** Stop for a day, or until told otherwise. */
export async function pauseGroupAgent(input: { hours: number | null; reason: string }): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!isOwnerLevel(profile.roles)) return { ok: false, error: "Only the owner can change this." };
  const until = input.hours ? new Date(Date.now() + input.hours * 3_600_000) : new Date("2099-01-01T00:00:00Z");
  try {
    await pauseAgent(profile.organization_id, profile.id, until, input.reason.trim().slice(0, 200) || "Paused by hand.");
  } catch (err) {
    console.error("agent pause failed:", err);
    return { ok: false, error: "Couldn't pause it. Try again." };
  }
  revalidatePath("/admin/outreach/agent");
  return { ok: true };
}

/**
 * Yes to one post: write the comment for it.
 *
 * The owner has already said it is worth answering, so the model's own
 * view of that is not asked; it only writes. The comment lands under
 * "Comments to approve" with the tracked link in it, for a last read
 * before it goes up. The pick is kept as a label either way.
 */
export async function acceptAgentPost(seenId: string): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  const row = await getSeen(profile.organization_id, seenId);
  if (!row) return { ok: false, error: "Couldn't find that post." };
  if (row.decision !== "read" && row.decision !== "advert") return { ok: false, error: "That one has already been picked." };
  if (!row.text) return { ok: false, error: "There are no words on that post to answer." };

  const read = await readAndDraft({ screenshotPath: null, pastedText: row.text, kind: "comment" });
  if (!read.ok) return { ok: false, error: read.error };
  if (!read.draft) return { ok: false, error: read.draftNote ?? "Couldn't write one for that post. Try again." };

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
  if (!recorded.ok) return { ok: false, error: recorded.error };

  const written = finishComment(read.draft.replace(LINK_MARKER, recorded.link), recorded.link);
  if (!looksUsable(written, recorded.link)) return { ok: false, error: "The comment came back too thin. Try again." };
  const { text: comment } = mentionComment(written, askedBy);

  const supabase = await createClient();
  await Promise.all([
    saveComment({ id: recorded.id, comment }),
    supabase.from("outreach_links").update({ via: "agent", post_url: row.url || null }).eq("id", recorded.id),
  ]);
  await setPicked(profile.organization_id, seenId, "accepted", { decision: "ready", reason: read.note, linkId: recorded.id });
  revalidatePath("/admin/outreach/agent");
  revalidatePath("/my-day");
  return { ok: true };
}

/**
 * The owner says what a post is: somebody asking for work, somebody
 * advertising, or neither. An advert's business is written down.
 */
export async function setAgentPostKind(input: { seenId: string; kind: "request" | "promotion" | "other" }): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  const result = await setPostKind(profile.organization_id, input.seenId, input.kind);
  if (!result.ok) return { ok: false, error: result.error ?? "Couldn't save that." };
  revalidatePath("/admin/outreach/agent");
  return { ok: true };
}

/** Sort whatever is still unsorted in the pile, now. */
export async function sortAgentPosts(): Promise<Result & { sorted?: number }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  const result = await sortReadPosts(profile.organization_id, { limit: 40 });
  revalidatePath("/admin/outreach/agent");
  return { ok: true, sorted: result.sorted };
}

/** Not a business worth keeping. Off the list, and it stays off. */
export async function removeAgentBusiness(id: string): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  try {
    await removeBusiness(profile.organization_id, id);
  } catch (err) {
    console.error("remove business failed:", err);
    return { ok: false, error: "Couldn't remove that. Try again." };
  }
  revalidatePath("/admin/outreach/agent");
  return { ok: true };
}

/** No to one post. Nothing is written, and the post is not shown again. */
export async function passAgentPost(seenId: string): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  const row = await getSeen(profile.organization_id, seenId);
  if (!row) return { ok: false, error: "Couldn't find that post." };
  if (row.decision !== "read") return { ok: false, error: "That one has already been picked." };
  try {
    await setPicked(profile.organization_id, seenId, "declined", { decision: "declined", reason: "Passed on." });
  } catch (err) {
    console.error("pass post failed:", err);
    return { ok: false, error: "Couldn't save that. Try again." };
  }
  revalidatePath("/admin/outreach/agent");
  return { ok: true };
}

/**
 * The owner pasted this one by hand.
 *
 * For a post the page showed without a link, which the browser cannot
 * open to comment on. The comment is marked posted, so the link's opens
 * and bookings count against the words.
 */
export async function markAgentCommentPosted(seenId: string): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  const row = await getSeen(profile.organization_id, seenId);
  if (!row || !row.link_id) return { ok: false, error: "Couldn't find that comment." };
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { data: link } = await supabase.from("outreach_links").select("comment").eq("id", row.link_id).maybeSingle();
  await supabase.from("outreach_links").update({ posted_comment: link?.comment ?? null, posted_comment_at: now }).eq("id", row.link_id);
  await supabase
    .from("outreach_seen_posts")
    .update({ decision: "posted", reason: "Pasted by hand.", updated_at: now })
    .eq("organization_id", profile.organization_id)
    .eq("id", seenId);
  revalidatePath("/admin/outreach/agent");
  revalidatePath("/my-day");
  return { ok: true };
}

/** Yes to one written comment, edits and all. The browser posts it on its next minute. */
export async function approveAgentComment(input: { seenId: string; comment: string }): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  const result = await approveReady(profile.organization_id, input.seenId, input.comment);
  if (!result.ok) return { ok: false, error: result.error ?? "Couldn't approve that." };
  revalidatePath("/admin/outreach/agent");
  revalidatePath("/my-day");
  return { ok: true };
}

/** No to one written comment. */
export async function declineAgentComment(input: { seenId: string; reason?: string }): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  const result = await declineReady(profile.organization_id, input.seenId, input.reason ?? null);
  if (!result.ok) return { ok: false, error: result.error ?? "Couldn't decline that." };
  revalidatePath("/admin/outreach/agent");
  revalidatePath("/my-day");
  return { ok: true };
}

/** The owner has joined this group, so its posts can be answered from now on. */
export async function markGroupJoined(id: string): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  try {
    await setGroupJoined(profile.organization_id, id, true);
  } catch (err) {
    console.error("mark group joined failed:", err);
    return { ok: false, error: "Couldn't save that. Try again." };
  }
  revalidatePath("/admin/outreach/agent");
  return { ok: true };
}

/** Not a group worth joining. Off the list, and stays off. */
export async function dismissGroupToJoin(id: string): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  try {
    await dismissGroup(profile.organization_id, id);
  } catch (err) {
    console.error("dismiss group failed:", err);
    return { ok: false, error: "Couldn't save that. Try again." };
  }
  revalidatePath("/admin/outreach/agent");
  return { ok: true };
}

export async function resumeGroupAgent(): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!isOwnerLevel(profile.roles)) return { ok: false, error: "Only the owner can change this." };
  try {
    await pauseAgent(profile.organization_id, profile.id, null, null);
  } catch (err) {
    console.error("agent resume failed:", err);
    return { ok: false, error: "Couldn't resume it. Try again." };
  }
  revalidatePath("/admin/outreach/agent");
  return { ok: true };
}

/**
 * Reddit on or off, in one press, from the top of the Group Agent page.
 * The subreddit list is left as it is.
 */
export async function setRedditEnabled(enabled: boolean): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!isOwnerLevel(profile.roles)) return { ok: false, error: "Only the owner can change this." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("outreach_agent_settings")
    .update({ reddit_enabled: enabled, updated_at: new Date().toISOString(), updated_by: profile.id })
    .eq("organization_id", profile.organization_id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/outreach/agent");
  return { ok: true };
}
