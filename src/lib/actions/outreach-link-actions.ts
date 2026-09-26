"use server";

import { revalidatePath } from "next/cache";

import Anthropic from "@anthropic-ai/sdk";

import { createClient } from "@/lib/supabase/server";
import { env, isAnthropicConfigured } from "@/lib/env";
import {
  checkComment,
  commentBrief,
  commentSystemPrompt,
  replyBrief,
  replySystemPrompt,
  finishComment,
  looksUsable,
  LINK_MARKER,
} from "@/lib/comment-prompt";
import { getCurrentProfile } from "@/lib/data/team";
import { activeServiceNames, readPostFromScreenshot } from "@/lib/data/read-post";
import { readingBrief } from "@/lib/post-reading";
import { parseReadAndDraft, readAndDraftSystemPrompt } from "@/lib/read-and-draft";
import { bookingSlug, getCurrentOrganization } from "@/lib/data/organizations";
import { outboundBaseUrl } from "@/lib/base-url";
import { hashBytes, looksLikeHash } from "@/lib/screenshot-hash";
import { shortWhen } from "@/lib/time-zone";
import { MAX_POSTED_CHARS, checkPosted, postedSummary } from "@/lib/posted-comment";
import {
  draftPosts,
  makeCode,
  trackedLink,
  MAX_SHOT_BYTES,
  OUTREACH_KINDS,
  PLATFORMS,
  RESPONSES,
  SHOT_TYPES,
  type OutreachKind,
  type OutreachResponse,
  type Platform,
  type PostDraft,
} from "@/lib/outreach-links";

export type RecordResult =
  | { ok: true; id: string; code: string; link: string; drafts: PostDraft[] }
  | { ok: false; error: string };

/**
 * Somewhere to put a screenshot before the record is written.
 *
 * Uploaded straight to storage from the browser with a short-lived signed URL,
 * because a Server Action carries a megabyte and a phone screenshot is
 * several. Only the path comes back through an action.
 */
export async function createShotUpload(input: {
  fileType: string;
  fileSize: number;
  /** The picture's fingerprint, so the duplicate check rides on this call rather than costing its own. */
  hash?: string | null;
}): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!SHOT_TYPES.includes(input.fileType)) {
    return { ok: false, error: "That needs to be a PNG, a JPG or a WebP." };
  }
  if (input.fileSize > MAX_SHOT_BYTES) return { ok: false, error: "That image is too big." };

  // The same picture twice is the same post twice, and two links under one
  // neighbour's question is what a group notices. Refused before the slot
  // is opened, from the fingerprint the phone worked out.
  if (input.hash && looksLikeHash(input.hash)) {
    const seen = await checkScreenshotSeen({ hash: input.hash });
    if (seen.ok && seen.seen) return { ok: false, error: describeSeen(seen.seen) };
  }

  const extension = input.fileType === "image/png" ? "png" : input.fileType === "image/webp" ? "webp" : "jpg";
  const path = `${profile.organization_id}/${crypto.randomUUID()}.${extension}`;

  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("recommendation-shots").createSignedUploadUrl(path);
  if (error || !data) {
    // Said plainly and logged properly. A storage policy that refuses the
    // write used to reach somebody standing in a garden as "new row violates
    // row-level security policy", which tells them nothing they can act on
    // and tells anybody watching how the database is built.
    console.error("couldn't open an upload slot for a screenshot:", error);
    return { ok: false, error: "Couldn't upload that just now. Try again in a moment." };
  }
  return { ok: true, path: data.path, token: data.token };
}

export type SeenShot = { when: string; groupName: string | null; byName: string | null; code: string };
export type SeenResult = { ok: true; seen: SeenShot | null } | { ok: false; error: string };

/**
 * Give every old screenshot its fingerprint, once.
 *
 * Records from before the fingerprint existed are hashed on the first
 * check that finds any of them unhashed, a handful at a time, so the
 * duplicate check covers the whole pile rather than only what came after.
 */
async function hashOldScreenshots(organizationId: string): Promise<void> {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("outreach_links")
    .select("id, screenshot_path")
    .eq("organization_id", organizationId)
    .is("screenshot_hash", null)
    .not("screenshot_path", "is", null)
    .limit(40);
  for (const row of (rows ?? []) as { id: string; screenshot_path: string }[]) {
    const { data: file } = await supabase.storage.from("recommendation-shots").download(row.screenshot_path);
    // A missing file gets a marker rather than staying null forever, so the
    // next check does not download the same absence again.
    const hash = file ? await hashBytes(await file.arrayBuffer()) : "missing";
    await supabase.from("outreach_links").update({ screenshot_hash: hash }).eq("id", row.id);
  }
}

/** Whether this exact picture has been recorded before, and by whom. */
async function seenBefore(organizationId: string, hash: string): Promise<SeenShot | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("outreach_links")
    .select("code, created_at, audience, profiles(full_name, email)")
    .eq("organization_id", organizationId)
    .eq("screenshot_hash", hash)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const row = data as unknown as {
    code: string;
    created_at: string;
    audience: string | null;
    profiles: { full_name: string | null; email: string } | null;
  } | null;
  if (!row) return null;
  return {
    when: shortWhen(row.created_at),
    groupName: row.audience,
    byName: row.profiles?.full_name || row.profiles?.email || null,
    code: row.code,
  };
}

/**
 * Has this picture been used already?
 *
 * Asked before the upload, from the fingerprint the phone works out, so a
 * screenshot that is already on the board never goes up a second time.
 */
export async function checkScreenshotSeen(input: { hash: string }): Promise<SeenResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!looksLikeHash(input.hash)) return { ok: false, error: "That picture could not be checked." };
  try {
    await hashOldScreenshots(profile.organization_id);
    return { ok: true, seen: await seenBefore(profile.organization_id, input.hash) };
  } catch (err) {
    console.error("screenshot check failed:", err);
    // Failing open: a check that cannot run must not stop a real lead.
    return { ok: true, seen: null };
  }
}

export type ReadResult =
  | {
      ok: true;
      platform: Platform | null;
      groupName: string | null;
      askedBy: string | null;
      note: string;
      ageDays: number | null;
      /** False when the post is an advert or ordinary chatter, not a lead. */
      worthAnswering: boolean;
    }
  | { ok: false; error: string };

/**
 * Read the screenshot and fill the form in.
 *
 * The form used to ask for the platform, the group, who asked and what they
 * want, which is four things to type standing in somebody's garden. Three of
 * them are already in the picture: the group is written across the top, the
 * name is beside the profile picture, and the app is obvious from the chrome
 * around it. So the picture is read and the boxes come back filled, leaving a
 * person to correct rather than compose.
 *
 * Everything it returns is editable afterwards. A group name read slightly
 * wrong is a tally split in two, so the person who was there gets the last
 * word — but they get it by glancing at a filled box rather than typing into
 * an empty one.
 */
export async function readRecommendationScreenshot(input: {
  screenshotPath: string;
}): Promise<ReadResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!isAnthropicConfigured) {
    return { ok: false, error: "Reading screenshots isn't set up on this site yet." };
  }

  const services = await activeServiceNames(profile.organization_id);
  const read = await readPostFromScreenshot({
    screenshotPath: input.screenshotPath,
    pastedText: "",
    note: "",
    // Left empty on purpose: this is somebody else's group, so the picture is
    // the only thing that knows its name.
    groupName: "",
    services,
    blockWords: [],
  });

  if (!read) return { ok: false, error: "Couldn't read that one. Fill it in and carry on." };

  // The service where the post named one, because that is the word a proposal
  // gets built from, and the sentence otherwise.
  const note = [read.service, read.summary].filter(Boolean).join(" — ");

  return {
    ok: true,
    platform: read.platform,
    groupName: read.groupName,
    askedBy: read.author,
    note,
    ageDays: read.ageDays,
    worthAnswering: read.kind === "request",
  };
}

/**
 * Write down a reply somebody posted, and hand back what to paste.
 *
 * The code is made here rather than in the browser, so it is the same code
 * that is stored and the same one that goes in the link. A link carrying a
 * code nothing recorded is a link that can never be counted.
 *
 * Open to anybody signed in. Answering a neighbour who asked for a landscaper
 * is not an admin task, and an affiliate who cannot record their own reply is
 * an affiliate who stops making them.
 */
export async function recordOutreach(input: {
  kind: OutreachKind;
  platform: Platform;
  /** The group, neighbourhood, subreddit or feed it landed in. */
  audience: string;
  /** Which of our pages or accounts it went out from, on a post of ours. */
  fromPage: string;
  /** Who it was aimed at, where it was aimed at one person. */
  sentTo: string;
  service: string;
  note: string;
  screenshotPath: string | null;
  /** The picture's fingerprint, so the same one cannot be recorded twice. */
  screenshotHash?: string | null;
}): Promise<RecordResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };

  // Checked again here, not only on the phone: two people uploading the
  // same post at the same moment both passed the first check.
  const hash = input.screenshotHash && looksLikeHash(input.screenshotHash) ? input.screenshotHash : null;
  if (hash) {
    const seen = await seenBefore(profile.organization_id, hash).catch(() => null);
    if (seen) return { ok: false, error: describeSeen(seen) };
  }
  if (!PLATFORMS.some((p) => p.key === input.platform)) {
    return { ok: false, error: "Pick where you saw it." };
  }
  if (!OUTREACH_KINDS.some((k) => k.key === input.kind)) {
    return { ok: false, error: "Say what carried the link." };
  }

  const supabase = await createClient();
  const [organization, baseUrl] = await Promise.all([
    getCurrentOrganization(),
    outboundBaseUrl(),
    // Minted now rather than at click time, so the first stranger to open the
    // link is not the one who finds out the business never had a slug.
    bookingSlug().catch(() => null),
  ]);

  // Retried on the tiny chance of a collision, rather than failing on one.
  // The column is unique, so a clash is a rejected insert and not a duplicate.
  let code = makeCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase.from("outreach_links").insert({
      organization_id: profile.organization_id,
      profile_id: profile.id,
      code,
      kind: input.kind,
      platform: input.platform,
      audience: input.audience.trim() || null,
      from_page: input.fromPage.trim().slice(0, 120) || null,
      sent_to: input.sentTo.trim().slice(0, 80) || null,
      service: input.service.trim().slice(0, 120) || null,
      note: input.note.trim().slice(0, 500) || null,
      screenshot_path: input.screenshotPath,
      screenshot_hash: hash,
    }).select("id").single();

    if (!error && data) {
      revalidatePath("/admin/outreach");
      // Short, and through our own route, so every open is counted. Where it
      // lands is worked out at click time from the code, so a link already
      // pasted into somebody else's thread keeps working when the destination
      // changes underneath it.
      const link = trackedLink(baseUrl, code);
      return {
        ok: true,
        id: data.id,
        code,
        link,
        drafts: draftPosts(
          {
            businessName: organization.name,
            newsMention: null,
            reviewCount: null,
            reviewStars: null,
          },
          link
        ),
      };
    }

    if (error && !/duplicate|unique/i.test(error.message)) {
      return { ok: false, error: error.message };
    }
    code = makeCode();
  }

  return { ok: false, error: "Couldn't get a unique link. Try once more." };
}

export type ReadAndDraftResult =
  | {
      ok: true;
      platform: Platform | null;
      groupName: string | null;
      askedBy: string | null;
      note: string;
      ageDays: number | null;
      worthAnswering: boolean;
      /** What the reader made of it, for a caller deciding without a person. */
      kind: "request" | "promotion" | "other";
      service: string | null;
      /** The words, with the link placeholder still in them. Null when none came back. */
      draft: string | null;
      draftNote: string | null;
    }
  | { ok: false; error: string };

/**
 * Read the post and write the words, in one go.
 *
 * The reading fills the boxes; the draft waits, placeholder and all, for
 * the link the record will mint. By the time somebody has checked the group
 * name and pressed the button, the comment is already written.
 */
export async function readAndDraft(input: {
  screenshotPath: string | null;
  /** The post's own words, when there is text rather than a picture. */
  pastedText?: string;
  kind: OutreachKind;
  /** How many days ago the post went up, when that is known; it decides the comment's opening. */
  ageDays?: number | null;
}): Promise<ReadAndDraftResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!isAnthropicConfigured) return { ok: false, error: "Reading posts isn't set up on this site yet." };
  if (!input.screenshotPath && !input.pastedText?.trim()) return { ok: false, error: "Nothing to read." };

  try {
    const supabase = await createClient();
    const organization = await getCurrentOrganization();
    const [{ data: serviceRows }, services] = await Promise.all([
      supabase.from("services").select("name, status, performed_by").eq("organization_id", organization.id),
      activeServiceNames(organization.id),
    ]);
    const live = (serviceRows ?? []).filter((row) => row.status !== "archived");
    const ownServices = live.filter((row) => row.performed_by !== "partner" && row.status === "active").map((row) => row.name).filter(Boolean);
    const partnerServices = live.filter((row) => row.performed_by === "partner").map((row) => row.name).filter(Boolean);

    const content: Anthropic.ContentBlockParam[] = [];
    if (input.screenshotPath) {
      const { data: file } = await supabase.storage.from("recommendation-shots").download(input.screenshotPath);
      if (file) {
        const type = file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg";
        content.push({ type: "image", source: { type: "base64", media_type: type, data: Buffer.from(await file.arrayBuffer()).toString("base64") } });
      }
    }
    const isMessage = input.kind === "dm";
    content.push({
      type: "text",
      text: [
        readingBrief({ pastedText: input.pastedText ?? "", note: "" }),
        "",
        isMessage
          ? replyBrief({ note: "", ownServices, partnerServices })
          : commentBrief({ businessName: organization.name, note: "", where: "", ageDays: input.ageDays ?? null, ownServices, partnerServices }),
      ].join("\n"),
    });

    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 1600,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: readAndDraftSystemPrompt({
        reading: { groupName: "", services, blockWords: [] },
        writing: isMessage
          ? replySystemPrompt(organization.name, { own: ownServices, partner: partnerServices }, profile.roles)
          : commentSystemPrompt(organization.name, { own: ownServices, partner: partnerServices }, profile.roles),
        what: isMessage ? "reply" : "comment",
      }),
      messages: [{ role: "user", content }],
    });
    if (response.stop_reason === "refusal") return { ok: false, error: "Couldn't read that one. Fill it in and carry on." };

    const raw = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const { reading, comment } = parseReadAndDraft(raw, services, isMessage ? "reply" : "comment");
    if (!reading) return { ok: false, error: "Couldn't read that one. Fill it in and carry on." };

    // Checked now, before anybody can copy it, the same as before.
    let draft: string | null = null;
    let draftNote: string | null = null;
    if (comment) {
      const check = checkComment(comment.replace(LINK_MARKER, ""));
      if (check.ok) draft = comment;
      else {
        console.error("comment draft refused:", check.problems, comment);
        draftNote = `Wouldn't send that one. ${check.problems.join(" ")} Use a wording below.`;
      }
    } else if (reading.kind === "request") {
      draftNote = "Couldn't write one for that post. The wordings below still work.";
    }

    return {
      ok: true,
      platform: reading.platform,
      groupName: reading.groupName,
      askedBy: reading.author,
      note: [reading.service, reading.summary].filter(Boolean).join(" — "),
      ageDays: reading.ageDays,
      worthAnswering: reading.kind === "request",
      kind: reading.kind,
      service: reading.service,
      draft,
      draftNote,
    };
  } catch (err) {
    console.error("read and draft failed:", err);
    return { ok: false, error: "Couldn't read that one. Fill it in and carry on." };
  }
}

export type CommentResult =
  | { ok: true; comment: string }
  | { ok: false; error: string };

/**
 * Read the post and write the comment.
 *
 * The three canned paragraphs could not do the one thing that matters: name
 * the thing the person actually asked for. A comment about lawns under a post
 * about a retaining wall is a comment nobody replies to. So the screenshot is
 * read and the comment written from it, to the rules the owner wrote.
 *
 * The link is put in afterwards rather than asked for. A model asked for a URL
 * will sooner or later invent one, and an invented booking link is worse than
 * no comment at all.
 *
 * Falls back rather than fails: without a key, or when the model returns
 * something thin, the caller still has the written-by-hand drafts.
 */
export async function draftCommentFromScreenshot(input: {
  screenshotPath: string;
  link: string;
  groupName: string;
  note: string;
  /** How old the post is, from the reading. Decides the opener. */
  ageDays: number | null;
  /**
   * What carried the link. A direct message gets a reply to one person's
   * message rather than a comment introducing the business to a room.
   */
  kind?: OutreachKind;
}): Promise<CommentResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!isAnthropicConfigured) {
    return { ok: false, error: "The comment writer isn't set up on this site yet." };
  }

  try {
    const supabase = await createClient();
    const { data: file, error } = await supabase.storage
      .from("recommendation-shots")
      .download(input.screenshotPath);
    if (error || !file) return { ok: false, error: "Couldn't open that screenshot." };

    const type = file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg";
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

    const organization = await getCurrentOrganization();

    // What this business actually does, from its own service list. Without it
    // the model had nothing to check itself against and simply agreed with
    // the post: a neighbour asking about tree removal got a comment saying
    // "we handle tree and mulberry removal" from a business that does not do
    // tree work and is not licensed for it.
    const { data: serviceRows } = await supabase
      .from("services")
      .select("name, status, performed_by")
      .eq("organization_id", organization.id);

    const live = (serviceRows ?? []).filter((row) => row.status !== "archived");

    // Only an active service counts as something we do. A pending one is work
    // somebody asked about and nobody has priced or set up, and saying "we do
    // that" about it is the same class of claim as saying it about tree work.
    const ownServices = live
      .filter((row) => row.performed_by !== "partner" && row.status === "active")
      .map((row) => row.name)
      .filter(Boolean);

    // Partner work does not have to be active to be offered, because what is
    // being offered is a phone call rather than a crew.
    const partnerServices = live
      .filter((row) => row.performed_by === "partner")
      .map((row) => row.name)
      .filter(Boolean);

    const isMessage = input.kind === "dm";
    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 1200,
      thinking: { type: "adaptive" },
      // Reading a screenshot and matching the service asked for is judgement,
      // not just writing, so this is worth more than the lowest setting.
      output_config: { effort: "medium" },
      system: isMessage
        ? replySystemPrompt(organization.name, { own: ownServices, partner: partnerServices }, profile.roles)
        : commentSystemPrompt(organization.name, { own: ownServices, partner: partnerServices }, profile.roles),
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: type, data: base64 } },
            {
              type: "text",
              text: isMessage
                ? replyBrief({ note: input.note, ownServices, partnerServices })
                : commentBrief({
                    businessName: organization.name,
                    note: input.note,
                    where: input.groupName,
                    ageDays: input.ageDays,
                    ownServices,
                    partnerServices,
                  }),
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, error: "Couldn't write one for that post." };
    }

    const raw = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const comment = finishComment(raw, input.link);

    // Checked before anybody can copy it. A comment goes out under the
    // business's name in front of a few thousand neighbours, and a claim to
    // hold a licence it does not hold is not something to leave to a prompt.
    const check = checkComment(comment.replace(input.link, ""));
    if (!check.ok) {
      console.error("comment draft refused:", check.problems, comment);
      return {
        ok: false,
        error: `Wouldn't send that one. ${check.problems.join(" ")} Try again, or use a wording below.`,
      };
    }

    if (!looksUsable(comment, input.link)) {
      return { ok: false, error: "That came back too thin to use. The wordings below still work." };
    }
    return { ok: true, comment };
  } catch (err) {
    console.error("comment draft failed:", err);
    return { ok: false, error: "Couldn't read that post. The wordings below still work." };
  }
}

/**
 * What came back from the person, said by the person who asked.
 *
 * Nothing can see a reply on Facebook. Guessing would be worse than asking: a
 * lead marked ignored because a scraper missed a comment is a lead nobody ever
 * follows up. So this is one tap, next to the thing it is about.
 *
 * Clearing it is allowed, because the first answer is often "no reply" and the
 * second, three days later, is "they replied".
 */
export async function recordResponse(input: {
  id: string;
  response: OutreachResponse | null;
  note: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (input.response !== null && !RESPONSES.some((r) => r.key === input.response)) {
    return { ok: false, error: "That isn't one of the answers." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("outreach_links")
    .update({
      response: input.response,
      responded_at: input.response ? new Date().toISOString() : null,
      response_note: input.response ? input.note.trim().slice(0, 300) || null : null,
    })
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/outreach");
  return { ok: true };
}

/**
 * Keep the comment that was written for a post.
 *
 * It used to be produced, shown once, pasted and thrown away. Fine right up
 * until the paste fails, the phone locks, or somebody wants to answer a second
 * post in the same group and would rather start from what worked than from a
 * blank box. Cheap to keep and impossible to recover.
 *
 * Never fatal: a comment on screen that failed to save is still a comment on
 * screen, and interrupting somebody mid-paste to tell them about a database
 * write is the wrong trade.
 */
export async function saveComment(input: {
  id: string;
  comment: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("outreach_links")
    .update({ comment: input.comment.trim().slice(0, 4000) || null })
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/outreach");
  return { ok: true };
}

export type PostedResult =
  | { ok: true; summary: string; hasLink: boolean; problems: string[] }
  | { ok: false; error: string };

/**
 * What was actually posted, pasted back by the person who posted it.
 *
 * The draft stays where it was. This is the other half: the comment as it
 * went up, edited or rewritten or as written, so the opens counted against
 * the link belong to words somebody can read later. Recorded even when the
 * check finds something to fix, because it is already in front of the
 * neighbours and the record is what makes it fixable; the problems come back
 * so the person can go and change the live comment.
 */
export async function recordPostedComment(input: {
  id: string;
  text: string;
}): Promise<PostedResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };

  const posted = input.text.trim().slice(0, MAX_POSTED_CHARS);
  if (!posted) return { ok: false, error: "Paste what you posted first." };

  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from("outreach_links")
    .select("id, code, comment")
    .eq("id", input.id)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!row) return { ok: false, error: "Couldn't find that post." };

  const link = trackedLink(await outboundBaseUrl(), row.code);
  const check = checkPosted({ draft: row.comment, posted, link });

  const { error } = await supabase
    .from("outreach_links")
    .update({ posted_comment: posted, posted_comment_at: new Date().toISOString() })
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/outreach");
  return { ok: true, summary: postedSummary(check), hasLink: check.hasLink, problems: check.problems };
}

/** The refusal, with enough in it to find the first one. */
function describeSeen(seen: SeenShot): string {
  const who = seen.byName ? ` by ${seen.byName}` : "";
  const where = seen.groupName ? ` for ${seen.groupName}` : "";
  return `This screenshot was already used${where}${who} on ${seen.when}. It already has a link and a comment on the board.`;
}
