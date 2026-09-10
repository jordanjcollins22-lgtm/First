"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { outboundBaseUrl } from "@/lib/base-url";
import { draftPosts, makeCode, recommendationLink, PLATFORMS, type Platform, type PostDraft } from "@/lib/recommendations";

export type RecordResult =
  | { ok: true; code: string; link: string; drafts: PostDraft[] }
  | { ok: false; error: string };

/** How big a screenshot may be. A phone screenshot is well under this. */
export const MAX_SHOT_BYTES = 8 * 1024 * 1024;
export const SHOT_TYPES = ["image/png", "image/jpeg", "image/webp"];

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
