import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { inDemo } from "@/lib/demo-mode";
import { DEMO_BLOCKED } from "@/lib/demo-guard";
import { postingPage } from "@/lib/data/meta";

/**
 * One photo post on the business's Facebook Page.
 *
 * The Graph API's photos edge: the image by URL and the caption as the
 * message. Published the moment it is called, so the caller is the one
 * deciding when, which the scheduled-posts cron already does.
 *
 * The page is the one ticked "Posting" in Admin > Facebook & Instagram, with
 * the key that connection fetched. FACEBOOK_PAGE_ID and its token are only
 * the fallback from before the connection lived in the app.
 *
 * The token never leaves this file and never reaches the log.
 */
const GRAPH = "https://graph.facebook.com/v21.0";

export type PublishResult = { ok: true; postId: string } | { ok: false; message: string };

async function target(organizationId: string): Promise<{ pageId: string; token: string } | null> {
  const connected = await postingPage(organizationId).catch(() => null);
  if (connected) return connected;
  return env.facebookPageId && env.facebookPageAccessToken ? { pageId: env.facebookPageId, token: env.facebookPageAccessToken } : null;
}

/** Whether this business has a page the week's posts can go to. */
export async function canPublishToFacebook(organizationId: string): Promise<boolean> {
  return Boolean(await target(organizationId));
}

export async function publishPhotoToPage(input: { organizationId: string; imageUrl: string; caption: string }): Promise<PublishResult> {
  const page = await target(input.organizationId);
  if (!page) {
    return { ok: false, message: "Facebook is not set up. Connect a page in Admin → Facebook & Instagram and tick Posting." };
  }
  // A demo posts nothing (lib/demo-guard.ts).
  if (await inDemo()) return { ok: false, message: DEMO_BLOCKED };
  const body = new URLSearchParams({
    url: input.imageUrl,
    message: input.caption,
    access_token: page.token,
  });
  try {
    const response = await fetch(`${GRAPH}/${page.pageId}/photos`, { method: "POST", body });
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
