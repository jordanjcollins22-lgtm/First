"use server";

import { revalidatePath } from "next/cache";

import Anthropic from "@anthropic-ai/sdk";

import { createClient } from "@/lib/supabase/server";
import { env, isAnthropicConfigured } from "@/lib/env";
import { commentBrief, commentSystemPrompt, finishComment, looksUsable } from "@/lib/comment-prompt";
import { getCurrentProfile } from "@/lib/data/team";
import { activeServiceNames, readPostFromScreenshot } from "@/lib/data/read-post";
import { bookingSlug, getCurrentOrganization } from "@/lib/data/organizations";
import { outboundBaseUrl } from "@/lib/base-url";
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
  | { ok: true; code: string; link: string; drafts: PostDraft[] }
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
}): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!SHOT_TYPES.includes(input.fileType)) {
    return { ok: false, error: "That needs to be a PNG, a JPG or a WebP." };
  }
  if (input.fileSize > MAX_SHOT_BYTES) return { ok: false, error: "That image is too big." };

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
}): Promise<RecordResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
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
    const { error } = await supabase.from("outreach_links").insert({
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
    });

    if (!error) {
      revalidatePath("/admin/outreach");
      // Short, and through our own route, so every open is counted. Where it
      // lands is worked out at click time from the code, so a link already
      // pasted into somebody else's thread keeps working when the destination
      // changes underneath it.
      const link = trackedLink(baseUrl, code);
      return {
        ok: true,
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

    if (!/duplicate|unique/i.test(error.message)) return { ok: false, error: error.message };
    code = makeCode();
  }

  return { ok: false, error: "Couldn't get a unique link. Try once more." };
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
    const client = new Anthropic({ apiKey: env.anthropicApiKey });
    const response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 1200,
      thinking: { type: "adaptive" },
      // Reading a screenshot and matching the service asked for is judgement,
      // not just writing, so this is worth more than the lowest setting.
      output_config: { effort: "medium" },
      system: commentSystemPrompt(organization.name),
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: type, data: base64 } },
            {
              type: "text",
              text: commentBrief({
                businessName: organization.name,
                note: input.note,
                where: input.groupName,
                ageDays: input.ageDays,
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
