import { NextResponse, type NextRequest } from "next/server";

import { getCurrentProfile } from "@/lib/data/team";
import { alreadySeen, getAgentSettings, recordSeen, type SeenInput } from "@/lib/data/outreach-agent";
import { readAndDraft, recordOutreach, saveComment } from "@/lib/actions/outreach-link-actions";
import { finishComment, LINK_MARKER, looksUsable } from "@/lib/comment-prompt";
import { ageDaysFromLabel, cleanPostUrl, matchesKeywords, postKeyFrom, worthAnswering } from "@/lib/outreach-agent";
import { createClient } from "@/lib/supabase/server";

/**
 * The posts the browser found, and which of them to answer.
 *
 * The browser sends every post on a group's first screen that mentions the
 * work. This side throws out the ones already decided about, reads the rest,
 * writes a comment for each one that is a real request for something we
 * sell, mints its tracked link, and hands back the finished words. Under
 * the caps, and never more than a few reads per call: a route has a minute,
 * and a read takes a good part of ten seconds.
 *
 * Every post that gets this far is written down with its decision, whether
 * or not it is answered, so the same post is never read twice and the
 * board can show what was passed over and why.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_READS_PER_CALL = 4;

interface IncomingPost {
  url: string;
  text: string;
  author?: string | null;
  ageLabel?: string | null;
}

export interface AgentAction {
  seenId: string;
  linkId: string;
  code: string;
  url: string;
  comment: string;
  /** False when the comment is written but must be pasted by a person. */
  post: boolean;
}

export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: { groupUrl?: string; groupName?: string; posts?: IncomingPost[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const groupName = (body.groupName ?? "").trim().slice(0, 120);
  const posts = Array.isArray(body.posts) ? body.posts.slice(0, 40) : [];

  const now = new Date();
  const settings = await getAgentSettings(profile.organization_id);

  // Keyed, cleaned, and matched again here. The browser filtered already,
  // but the browser is the part somebody can edit.
  const fresh = new Map<string, IncomingPost & { key: string; url: string }>();
  for (const post of posts) {
    const key = typeof post.url === "string" ? postKeyFrom(post.url) : null;
    if (!key || fresh.has(key)) continue;
    if (!matchesKeywords(post.text ?? "", settings.keywords)) continue;
    fresh.set(key, { ...post, key, url: cleanPostUrl(post.url) });
  }
  const seen = await alreadySeen(profile.organization_id, Array.from(fresh.keys()));
  const unseen = Array.from(fresh.values()).filter((post) => !seen.has(post.key));

  // The caps are not applied here. The browser asks the app before every
  // comment whether the way is clear, so a lead found over the cap waits
  // in the queue for the next hour rather than being passed over.
  const actions: AgentAction[] = [];
  const decided: { key: string; decision: string }[] = [];
  let reads = 0;
  let looked = 0;

  for (const post of unseen) {
    if (reads >= MAX_READS_PER_CALL) break;
    looked += 1;

    const ageDays = ageDaysFromLabel(post.ageLabel, now);
    const base: Omit<SeenInput, "decision" | "reason" | "linkId"> = {
      postKey: post.key,
      url: post.url,
      groupName: groupName || null,
      author: post.author?.trim().slice(0, 80) || null,
      text: post.text,
      ageDays,
    };

    // Cheap refusals first, so a stale post never costs a read.
    if (ageDays != null && ageDays > settings.maxAgeDays) {
      await recordSeen(profile.organization_id, profile.id, { ...base, decision: "too_old", reason: `Posted ${ageDays} days ago.`, linkId: null });
      decided.push({ key: post.key, decision: "too_old" });
      continue;
    }

    reads += 1;
    const read = await readAndDraft({ screenshotPath: null, pastedText: post.text, kind: "comment" });
    if (!read.ok) {
      await recordSeen(profile.organization_id, profile.id, { ...base, decision: "draft_failed", reason: read.error, linkId: null });
      decided.push({ key: post.key, decision: "draft_failed" });
      continue;
    }

    const verdict = worthAnswering({
      kind: read.kind,
      service: read.service,
      ageDays: read.ageDays ?? ageDays,
      maxAgeDays: settings.maxAgeDays,
    });
    if (!verdict.yes) {
      await recordSeen(profile.organization_id, profile.id, {
        ...base,
        author: base.author ?? read.askedBy,
        ageDays: read.ageDays ?? ageDays,
        decision: verdict.decision,
        reason: [verdict.reason, read.note].filter(Boolean).join(" "),
        linkId: null,
      });
      decided.push({ key: post.key, decision: verdict.decision });
      continue;
    }

    if (!read.draft) {
      await recordSeen(profile.organization_id, profile.id, { ...base, decision: "draft_failed", reason: read.draftNote ?? "No comment came back.", linkId: null });
      decided.push({ key: post.key, decision: "draft_failed" });
      continue;
    }

    // The link is minted by the same record every hand-written reply uses,
    // so the board, the commission and the bookings all count it the same.
    const recorded = await recordOutreach({
      kind: "comment",
      platform: "facebook",
      audience: read.groupName || groupName,
      fromPage: "",
      sentTo: read.askedBy ?? base.author ?? "",
      service: read.service ?? "",
      note: read.note,
      screenshotPath: null,
    });
    if (!recorded.ok) {
      await recordSeen(profile.organization_id, profile.id, { ...base, decision: "draft_failed", reason: recorded.error, linkId: null });
      decided.push({ key: post.key, decision: "draft_failed" });
      continue;
    }

    const comment = finishComment(read.draft.replace(LINK_MARKER, recorded.link), recorded.link);
    if (!looksUsable(comment, recorded.link)) {
      await recordSeen(profile.organization_id, profile.id, { ...base, decision: "draft_failed", reason: "The comment came back too thin to post.", linkId: recorded.id });
      decided.push({ key: post.key, decision: "draft_failed" });
      continue;
    }

    const supabase = await createClient();
    await Promise.all([
      saveComment({ id: recorded.id, comment }),
      supabase.from("outreach_links").update({ via: "agent", post_url: post.url }).eq("id", recorded.id),
    ]);

    const decision = settings.autoPost ? "queued" : "ready";
    const seenId = await recordSeen(profile.organization_id, profile.id, {
      ...base,
      author: base.author ?? read.askedBy,
      ageDays: read.ageDays ?? ageDays,
      decision,
      reason: read.note,
      linkId: recorded.id,
    });
    decided.push({ key: post.key, decision });
    if (!seenId) continue;
    actions.push({ seenId, linkId: recorded.id, code: recorded.code, url: post.url, comment, post: settings.autoPost });
  }

  return NextResponse.json({
    ok: true,
    actions,
    decided,
    skipped: posts.length - unseen.length,
    moreToRead: unseen.length > looked,
  });
}
