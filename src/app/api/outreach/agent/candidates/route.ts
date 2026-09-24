import { NextResponse, type NextRequest } from "next/server";

import { getCurrentProfile } from "@/lib/data/team";
import {
  alreadySeen,
  getAgentSettings,
  joinedGroupKeys,
  noteGroup,
  recordSeen,
  type SeenInput,
} from "@/lib/data/outreach-agent";
import { readAndDraft, recordOutreach, saveComment } from "@/lib/actions/outreach-link-actions";
import { finishComment, LINK_MARKER, looksUsable } from "@/lib/comment-prompt";
import {
  ageDaysFromLabel,
  cleanPostUrl,
  groupKeyFrom,
  groupUrlFrom,
  inArea,
  isAnonymousAuthor,
  matchesKeywords,
  mentionComment,
  postKeyFrom,
  worthAnswering,
  type ScanSource,
} from "@/lib/outreach-agent";
import { createClient } from "@/lib/supabase/server";

/**
 * The posts the browser found, and which of them to answer.
 *
 * The browser sends every post on a page that mentions the work: the
 * account's own groups feed, a search for a phrase, or one listed group.
 * This side throws out the ones already decided about, reads the rest,
 * writes a comment for each one that is a real request for something we
 * sell, mints its tracked link, and hands back the finished words. Never
 * more than a few reads per call: a route has a minute, and a read takes a
 * good part of ten seconds.
 *
 * A post found by search in a group the account is not in cannot be
 * answered. The group is written down with one more lead against it, so
 * the owner can see which groups are worth joining.
 *
 * Every post that gets this far is written down with its decision, so the
 * same post is never read twice and the board can show what was passed
 * over and why.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_READS_PER_CALL = 4;

interface IncomingPost {
  url: string;
  text: string;
  author?: string | null;
  anonymous?: boolean;
  ageLabel?: string | null;
  group?: { url?: string | null; name?: string | null } | null;
}

export interface AgentAction {
  seenId: string;
  linkId: string;
  code: string;
  url: string;
  comment: string;
  /** The first name to @-mention before the words, or null for an anonymous poster. */
  mention: string | null;
  groupName: string | null;
  /** False when the comment is written but must be pasted by a person. */
  post: boolean;
}

const SOURCES: ScanSource[] = ["feed", "search", "group"];

/** The browser's account of one look, with only the fields we keep, each bounded. */
function lookFrom(raw: { name?: unknown; source?: unknown; stats?: unknown; version?: unknown }, sent: number) {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100_000, Math.round(v))) : null);
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
  const stats = (raw.stats && typeof raw.stats === "object" ? raw.stats : {}) as Record<string, unknown>;
  const samples = Array.isArray(stats.samples) ? stats.samples.slice(0, 8) : [];
  return {
    name: str(raw.name, 120),
    source: str(raw.source, 20),
    version: str(raw.version, 20),
    title: str(stats.title, 80),
    posts: num(stats.posts),
    mentioned: num(stats.mentioned),
    mentionedNoLink: num(stats.mentionedNoLink),
    withLink: num(stats.withLink),
    textChars: num(stats.textChars),
    sent,
    samples: samples.map((s) => {
      const row = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      return { text: str(row.text, 120), link: row.link === true, matched: row.matched === true };
    }),
  };
}

export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: {
    source?: string;
    phrase?: string;
    groupUrl?: string;
    groupName?: string;
    posts?: IncomingPost[];
    look?: { name?: unknown; source?: unknown; stats?: unknown; version?: unknown } | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const source: ScanSource = SOURCES.includes(body.source as ScanSource) ? (body.source as ScanSource) : "group";
  const listedGroupName = (body.groupName ?? "").trim().slice(0, 120);
  const listedGroupKey = source === "group" ? groupKeyFrom(body.groupUrl) : null;
  const posts = Array.isArray(body.posts) ? body.posts.slice(0, 40) : [];

  const now = new Date();
  const [settings, joined] = await Promise.all([getAgentSettings(profile.organization_id), joinedGroupKeys(profile.organization_id)]);

  // What the page looked like, kept whether or not anything matched, so a
  // scanner that has stopped seeing posts shows up here and not only in a
  // popup on one computer. Trimmed: this is a diagnosis, not an archive.
  if (body.look && typeof body.look === "object") {
    await (await createClient())
      .from("outreach_agent_settings")
      .update({ last_look: lookFrom(body.look, posts.length), last_look_at: now.toISOString() })
      .eq("organization_id", profile.organization_id);
  }
  if (listedGroupKey) joined.add(listedGroupKey);

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

  const actions: AgentAction[] = [];
  const decided: { key: string; decision: string }[] = [];
  let reads = 0;
  let looked = 0;

  for (const post of unseen) {
    if (reads >= MAX_READS_PER_CALL) break;
    looked += 1;

    const groupKey = groupKeyFrom(post.group?.url) ?? groupKeyFrom(post.url) ?? listedGroupKey;
    const groupUrl = groupUrlFrom(post.group?.url) ?? groupUrlFrom(post.url) ?? groupUrlFrom(body.groupUrl);
    const groupName = (post.group?.name ?? "").trim().slice(0, 120) || listedGroupName || null;
    const anonymous = post.anonymous === true || isAnonymousAuthor(post.author);
    const author = anonymous ? null : post.author?.trim().slice(0, 80) || null;
    const ageDays = ageDaysFromLabel(post.ageLabel, now);
    const base: Omit<SeenInput, "decision" | "reason" | "linkId"> = {
      postKey: post.key,
      url: post.url,
      groupName,
      author,
      text: post.text,
      ageDays,
      source,
      groupKey,
    };
    const write = (decision: SeenInput["decision"], reason: string | null, linkId: string | null = null, extra: Partial<SeenInput> = {}) =>
      recordSeen(profile.organization_id, profile.id, { ...base, ...extra, decision, reason, linkId });

    // A post from the account's own feed proves the group is joined. One
    // from search proves nothing, and one from another state is nothing.
    if (source === "search" && !inArea(`${post.text} ${groupName ?? ""}`, settings.areaWords)) {
      await write("outside_area", "Doesn't mention anywhere near us.");
      decided.push({ key: post.key, decision: "outside_area" });
      continue;
    }
    if (groupKey && groupUrl) {
      const isJoined = source !== "search" || joined.has(groupKey);
      await noteGroup(profile.organization_id, { groupKey, url: groupUrl, name: groupName, joined: isJoined, foundPost: true });
      if (!isJoined) {
        await write("not_member", `In ${groupName ?? "a group"} you haven't joined. It's on the groups-to-join list.`);
        decided.push({ key: post.key, decision: "not_member" });
        continue;
      }
    }

    // Cheap refusals first, so a stale post never costs a read.
    if (ageDays != null && ageDays > settings.maxAgeDays) {
      await write("too_old", `Posted ${ageDays} days ago.`);
      decided.push({ key: post.key, decision: "too_old" });
      continue;
    }

    reads += 1;
    const read = await readAndDraft({ screenshotPath: null, pastedText: post.text, kind: "comment" });
    if (!read.ok) {
      await write("draft_failed", read.error);
      decided.push({ key: post.key, decision: "draft_failed" });
      continue;
    }

    const verdict = worthAnswering({
      kind: read.kind,
      service: read.service,
      ageDays: read.ageDays ?? ageDays,
      maxAgeDays: settings.maxAgeDays,
    });
    const askedBy = author ?? (anonymous ? null : read.askedBy);
    if (!verdict.yes) {
      await write(verdict.decision, [verdict.reason, read.note].filter(Boolean).join(" "), null, { author: askedBy, ageDays: read.ageDays ?? ageDays });
      decided.push({ key: post.key, decision: verdict.decision });
      continue;
    }

    if (!read.draft) {
      await write("draft_failed", read.draftNote ?? "No comment came back.");
      decided.push({ key: post.key, decision: "draft_failed" });
      continue;
    }

    // The link is minted by the same record every hand-written reply uses,
    // so the board, the commission and the bookings all count it the same.
    const recorded = await recordOutreach({
      kind: "comment",
      platform: "facebook",
      audience: groupName || read.groupName || "",
      fromPage: "",
      sentTo: askedBy ?? "",
      service: read.service ?? "",
      note: read.note,
      screenshotPath: null,
    });
    if (!recorded.ok) {
      await write("draft_failed", recorded.error);
      decided.push({ key: post.key, decision: "draft_failed" });
      continue;
    }

    const written = finishComment(read.draft.replace(LINK_MARKER, recorded.link), recorded.link);
    if (!looksUsable(written, recorded.link)) {
      await write("draft_failed", "The comment came back too thin to post.", recorded.id);
      decided.push({ key: post.key, decision: "draft_failed" });
      continue;
    }
    // Opened with the poster's name, the way a person answering does it.
    const { text: comment, mention } = mentionComment(written, askedBy);

    const supabase = await createClient();
    await Promise.all([
      saveComment({ id: recorded.id, comment }),
      supabase.from("outreach_links").update({ via: "agent", post_url: post.url }).eq("id", recorded.id),
    ]);

    const decision = settings.autoPost ? "queued" : "ready";
    const seenId = await write(decision, read.note, recorded.id, { author: askedBy, ageDays: read.ageDays ?? ageDays });
    decided.push({ key: post.key, decision });
    if (!seenId) continue;
    actions.push({ seenId, linkId: recorded.id, code: recorded.code, url: post.url, comment, mention, groupName, post: settings.autoPost });
  }

  return NextResponse.json({
    ok: true,
    actions,
    decided,
    skipped: posts.length - unseen.length,
    moreToRead: unseen.length > looked,
  });
}
