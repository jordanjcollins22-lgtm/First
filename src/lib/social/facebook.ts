import { env } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * One photo post on the business's Facebook Page.
 *
 * The Graph API's photos edge: the image by URL and the caption as the
 * message. Published the moment it is called, so the caller is the one
 * deciding when, which the scheduled-posts cron already does.
 *
 * The token never leaves this file and never reaches the log.
 */
const GRAPH = "https://graph.facebook.com/v21.0";

export type PublishResult = { ok: true; postId: string } | { ok: false; message: string };

export async function publishPhotoToPage(input: { imageUrl: string; caption: string }): Promise<PublishResult> {
  if (!env.facebookPageId || !env.facebookPageAccessToken) {
    return { ok: false, message: "Facebook is not set up. Add FACEBOOK_PAGE_ID and FACEBOOK_PAGE_ACCESS_TOKEN." };
  }
  const body = new URLSearchParams({
    url: input.imageUrl,
    message: input.caption,
    access_token: env.facebookPageAccessToken,
  });
  try {
    const response = await fetch(`${GRAPH}/${env.facebookPageId}/photos`, { method: "POST", body });
    const json = (await response.json().catch(() => ({}))) as { id?: string; post_id?: string; error?: { message?: string; code?: number } };
    if (!response.ok || json.error) {
      const message = json.error?.message ?? `Facebook answered ${response.status}.`;
      log.error("facebook.publish.failed", undefined, { status: response.status, code: json.error?.code, message });
      return { ok: false, message };
    }
    const postId = json.post_id ?? json.id ?? "";
    log.info("facebook.published", { postId });
    return { ok: true, postId };
  } catch (err) {
    log.error("facebook.publish.failed", err);
    return { ok: false, message: err instanceof Error ? err.message : "Could not reach Facebook." };
  }
}
