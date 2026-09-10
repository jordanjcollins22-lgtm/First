"use server";

import { revalidatePath } from "next/cache";

import Anthropic from "@anthropic-ai/sdk";

import { createClient } from "@/lib/supabase/server";
import { env, isAnthropicConfigured } from "@/lib/env";
import { commentBrief, commentSystemPrompt, finishComment, looksUsable } from "@/lib/comment-prompt";
import { getCurrentProfile } from "@/lib/data/team";
import { activeServiceNames, readPostFromScreenshot } from "@/lib/data/read-post";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { outboundBaseUrl } from "@/lib/base-url";
import {
  draftPosts,
  makeCode,
  recommendationLink,
  MAX_SHOT_BYTES,
  PLATFORMS,
  SHOT_TYPES,
  type Platform,
  type PostDraft,
} from "@/lib/recommendations";

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
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't get a place to put it." };
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
export async function recordRecommendation(input: {
  platform: Platform;
  groupName: string;
  askedBy: string;
  note: string;
  screenshotPath: string | null;
}): Promise<RecordResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (!PLATFORMS.some((p) => p.key === input.platform)) {
    return { ok: false, error: "Pick where you saw it." };
  }

  const supabase = await createClient();
  const [organization, baseUrl] = await Promise.all([getCurrentOrganization(), outboundBaseUrl()]);

  // Retried on the tiny chance of a collision, rather than failing on one.
  // The column is unique, so a clash is a rejected insert and not a duplicate.
  let code = makeCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { error } = await supabase.from("recommendations").insert({
      organization_id: profile.organization_id,
      profile_id: profile.id,
      code,
      platform: input.platform,
      group_name: input.groupName.trim() || null,
      asked_by: input.askedBy.trim().slice(0, 80) || null,
      note: input.note.trim().slice(0, 500) || null,
      screenshot_path: input.screenshotPath,
    });

    if (!error) {
      revalidatePath("/admin/recommendations");
      const link = recommendationLink({ baseUrl, affiliateSlug: profile.affiliate_slug ?? null, code });
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
