"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { getSeen, setPicked } from "@/lib/data/outreach-agent";
import { answersToPost, answersToSamePost } from "@/lib/data/post-board";
import { mentionComment } from "@/lib/outreach-agent";
import { alreadyAnswered, isAnswered, isPostLink, onePerPerson, whyNotTake } from "@/lib/post-board";
import { outsideServiceArea, posterToTag, withoutTeamMention, type ServiceMarket } from "@/lib/comment-guards";
import { readAndDraft, recordOutreach, saveComment } from "@/lib/actions/outreach-link-actions";
import { checkComment, draftFromDisplay, finishComment, introComment, LINK_MARKER, looksUsable, personaliseDraft } from "@/lib/comment-prompt";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { daysOld, fitOpenerToAge } from "@/lib/post-age";
import { createClient } from "@/lib/supabase/server";
import { setPostKind } from "@/lib/data/post-sorter";
import { draftWaitingPosts } from "@/lib/data/post-draft";
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
 *
 * When the board already wrote the comment (it does as the post is sorted),
 * that is used, with the taker's own opener, or `text` when they changed it
 * in the box first. Nothing to wait for: the only thing left to make is
 * their link. A post with nothing written yet is read and written now.
 */
export async function takePost(seenId: string, options: { text?: string } = {}): Promise<TakeResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  const org = profile.organization_id;

  const row = await getSeen(org, seenId);
  if (!row || row.decision !== "read") return { ok: false, error: "That post isn't on the board any more." };
  if (!row.text) return { ok: false, error: "There are no words on that post to answer." };
  // A post with no link is answered all the same: the card says who posted
  // it and where, and searches for it, so it can be found and commented on.

  const now = new Date();
  const supabase = await createClient();
  // Every copy of this post, and every answer to any of them: one comment
  // per person per post, however many times the post was kept.
  const same = await answersToSamePost(org, row);
  const answers = same.answers.filter((a) => same.postOf.get(a.id) === seenId);
  // Not even the owner answers the same post twice.
  const twice = alreadyAnswered(same.answers, profile.id, seenId, same.postOf);
  if (twice) return { ok: false, error: twice };
  // A link handed out by hand for this post, before the board, counts too.
  if (same.urls.length > 0) {
    const { data: links } = await supabase
      .from("outreach_links")
      .select("code")
      .eq("organization_id", org)
      .eq("profile_id", profile.id)
      .in("post_url", same.urls)
      .limit(20);
    // The board's own answers make links too; only one made some other way counts here.
    const fromBoard = new Set(same.answers.filter((x) => x.profileId === profile.id && x.code).map((x) => x.code));
    if ((links ?? []).some((l) => !fromBoard.has(l.code))) {
      return { ok: false, error: "You've already answered this post. One comment each, so it doesn't look like a campaign." };
    }
  }
  const owner = isOwnerLevel(profile.roles);
  const refusal = whyNotTake({
    answers: onePerPerson(same.answers),
    profileId: profile.id,
    now,
    override: owner,
  });
  if (refusal) return { ok: false, error: refusal };

  const guards = await guardsFor(org);
  const mineAlready = same.answers.some((a) => a.profileId === profile.id && a.status !== "let_go");
  if (!owner && !mineAlready) {
    const away = outsideServiceArea({ town: row.town ?? null, text: row.text, markets: guards.markets });
    if (away) return { ok: false, error: `${away} Leave it, or ask the office if we should take it.` };
  }

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
  // How old the post really is decides how the comment opens: from
  // yesterday or before, it asks whether they still need someone.
  const days = daysOld(row.posted_at ?? null, row.age_days ?? null, row.created_at, new Date());
  const edited = options.text?.trim() ? draftFromDisplay(options.text.trim()) : null;
  let read: { draft: string; askedBy: string | null; groupName: string | null; service: string | null; note: string };
  // Set when the writer would not write one: the introduction goes instead.
  let intro = false;
  if (edited || row.draft_comment) {
    // Checked again: what somebody typed into the box has to pass the same
    // rules as what the writer produced.
    if (edited) {
      const check = checkComment(edited.split(LINK_MARKER).join(""));
      if (!check.ok) return letGo(`Can't post that wording. ${check.problems.join(" ")}`);
    }
    const organization = await getCurrentOrganization();
    read = {
      draft: edited ?? personaliseDraft(row.draft_comment ?? "", profile.roles, organization.name),
      askedBy: row.draft_asked_by ?? null,
      groupName: null,
      service: row.draft_service ?? null,
      note: row.draft_note ?? "",
    };
  } else {
    const fresh = await readAndDraft({ screenshotPath: row.screenshot_path ?? null, pastedText: row.text, kind: "comment", ageDays: days });
    if (fresh.ok && fresh.draft) {
      read = { draft: fresh.draft, askedBy: fresh.askedBy, groupName: fresh.groupName, service: fresh.service, note: fresh.note };
    } else {
      // Nobody asking (a business thread, "advertise here") or it could not
      // be read: an introduction they can change, rather than a dead end
      // that says try again when trying again can never work.
      const organization = await getCurrentOrganization();
      intro = true;
      read = {
        draft: introComment(profile.roles, organization.name),
        askedBy: null,
        groupName: fresh.ok ? fresh.groupName : null,
        service: null,
        note: fresh.ok ? fresh.note : row.text ?? "",
      };
    }
  }

  // An introduction is to the room, not a reply to whoever started the thread.
  // Never a teammate: on a forwarded post the name kept is often whoever
  // forwarded it, and a comment tagging Jace under a stranger's post helps nobody.
  const askedBy = intro ? null : posterToTag(row.author ?? read.askedBy ?? null, row.text, guards.teamNames);
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

  const finished = finishComment(read.draft.replace(LINK_MARKER, recorded.link), recorded.link);
  // "Do you still need someone?" is for a request, not an introduction. A
  // post with no date on it is asked too: it may be days old, and the
  // question costs nothing under a fresh one.
  const written = intro ? finished : fitOpenerToAge(withoutTeamMention(finished, guards.teamNames), days ?? 1);
  const check = checkComment(written.split(recorded.link).join(""));
  if (!check.ok) return letGo(`Change the wording before posting. ${check.problems.join(" ")}`);
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

/**
 * What the checks on taking a post need: the team's names, so nobody on it
 * is tagged, and the area we work in. There is no wait between one
 * person's comments: each affiliate answers from their own page, so how
 * often they post is theirs to judge.
 */
async function guardsFor(org: string): Promise<{ teamNames: string[]; markets: ServiceMarket[] }> {
  const supabase = await createClient();
  const [{ data: team }, { data: markets }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("organization_id", org),
    supabase.from("target_markets").select("cities, counties, zips").eq("organization_id", org).eq("active", true),
  ]);
  return {
    teamNames: (team ?? []).map((p) => p.full_name ?? "").filter(Boolean),
    markets: (markets ?? []).map((m) => ({ cities: m.cities ?? [], counties: m.counties ?? [], zips: m.zips ?? [] })),
  };
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

/**
 * They had already commented on this post, straight on Facebook, before the
 * board brought it to them. Kept as answered by them, so it leaves their
 * board, is not offered to them again from any copy of it, and shows the
 * others it has been answered; but not counted as a comment from the board.
 */
export async function markAlreadyCommented(seenId: string): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("outreach_post_answers")
    .upsert(
      { organization_id: profile.organization_id, seen_post_id: seenId, profile_id: profile.id, status: "already", posted_at: now, updated_at: now },
      { onConflict: "seen_post_id,profile_id" }
    );
  if (error) return { ok: false, error: error.message };
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
      category: "for-us",
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
  // Written for the card now, for whoever answers it after the person who added it.
  after(() => draftWaitingPosts(org).then(() => undefined, (err) => console.error("drafting failed:", err)));
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
  if (standing.mine && isAnswered(standing.mine.status)) return { message: "Already in, and you've already answered it. One comment each.", canAnswer: false };
  if (standing.pile === "mine") return { message: "Already in, and it's yours: it's up next.", canAnswer: true };
  const names = standing.others.map((a) => `${a.name}${isAnswered(a.status) ? " answered it" : " is answering it"}`).join(", ");
  if (standing.pile === "full") return { message: `Already in: ${names}.`, canAnswer: false };
  return { message: names ? `Already in: ${names}. There's room for yours; it's up next.` : "Already in and nobody has answered it yet. It's up next.", canAnswer: true };
}
