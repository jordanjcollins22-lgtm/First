import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { inDemo } from "@/lib/demo-mode";
import { DEMO_BLOCKED } from "@/lib/demo-guard";
import { postingPage } from "@/lib/data/meta";
import { GRAPH_VERSION } from "@/lib/meta/graph";
import { classifyPublishError, NOT_CONNECTED, type PublishFailure } from "@/lib/social/autopost";
import type { SocialPlatform } from "@/lib/social/cadence";

/**
 * One photo post on the business's Facebook Page, and on the Instagram
 * account linked to it.
 *
 * Facebook: the Graph API's photos edge, the image by URL and the caption as
 * the message. Instagram: a media container from the image URL (which must
 * be a JPEG Meta can fetch), then media_publish. Both publish the moment they
 * are called; the scheduled-posts cron decides when.
 *
 * The page is the one ticked "Posting" in Admin > Facebook & Instagram, with
 * the key that connection fetched. FACEBOOK_PAGE_ID and its token are only
 * the fallback from before the connection lived in the app (Facebook only).
 *
 * The token never leaves this file and never reaches the log.
 */
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type PublishResult = { ok: true; postId: string } | { ok: false; message: string; failure: PublishFailure };

interface Target {
  pageId: string;
  token: string;
  instagramId: string | null;
}

async function target(organizationId: string): Promise<Target | null> {
  const connected = await postingPage(organizationId).catch(() => null);
  if (connected) return { pageId: connected.pageId, token: connected.token, instagramId: connected.instagramId };
  return env.facebookPageId && env.facebookPageAccessToken ? { pageId: env.facebookPageId, token: env.facebookPageAccessToken, instagramId: null } : null;
}

/** Whether this business has a page the week's posts can go to. */
export async function canPublishToFacebook(organizationId: string): Promise<boolean> {
  return Boolean(await target(organizationId));
}

/** Which accounts this business can publish to right now. */
export async function publishTargets(organizationId: string): Promise<{ facebook: boolean; instagram: boolean }> {
  const t = await target(organizationId);
  return { facebook: Boolean(t), instagram: Boolean(t?.instagramId) };
}

type GraphAnswer = { id?: string; post_id?: string; error?: { message?: string; code?: number; error_subcode?: number } };

async function graphPost(path: string, params: Record<string, string>): Promise<{ ok: true; json: GraphAnswer } | { ok: false; status: number; code: number | null; subcode: number | null; message: string }> {
  try {
    const response = await fetch(`${GRAPH}${path}`, { method: "POST", body: new URLSearchParams(params), cache: "no-store" });
    const json = (await response.json().catch(() => ({}))) as GraphAnswer;
    if (!response.ok || json.error) {
      return { ok: false, status: response.status, code: json.error?.code ?? null, subcode: json.error?.error_subcode ?? null, message: json.error?.message ?? `Meta answered ${response.status}.` };
    }
    return { ok: true, json };
  } catch (err) {
    return { ok: false, status: 0, code: null, subcode: null, message: err instanceof Error ? err.message : "Could not reach Meta." };
  }
}

function refused(platform: SocialPlatform, r: { status: number; code: number | null; subcode: number | null; message: string }): PublishResult {
  // The code says keys and permissions; the subcode is more specific for
  // pictures. The code first, then the subcode if the code said "try again".
  let failure = classifyPublishError({ code: r.code, status: r.status, message: r.message, platform });
  if (failure.kind === "transient" && r.subcode) failure = classifyPublishError({ code: r.subcode, status: r.status, message: r.message, platform });
  log.error(`${platform}.publish.failed`, undefined, { status: r.status, code: r.code, kind: failure.kind, message: r.message });
  return { ok: false, message: failure.reason, failure };
}

export async function publishPhotoToPage(input: { organizationId: string; imageUrl: string; caption: string }): Promise<PublishResult> {
  const page = await target(input.organizationId);
  if (!page) return { ok: false, message: NOT_CONNECTED.reason, failure: NOT_CONNECTED };
  // A demo posts nothing (lib/demo-guard.ts).
  if (await inDemo()) return { ok: false, message: DEMO_BLOCKED, failure: { kind: "permission", retry: false, reason: DEMO_BLOCKED } };
  const r = await graphPost(`/${page.pageId}/photos`, { url: input.imageUrl, message: input.caption, access_token: page.token });
  if (!r.ok) return refused("facebook", r);
  const postId = r.json.post_id ?? r.json.id ?? "";
  log.info("facebook.published", { postId });
  return { ok: true, postId };
}

/**
 * Instagram's two steps. The container is made from the picture's address;
 * Meta fetches it then and there, so a picture that can't be fetched fails
 * here, not later. A container is ready at once for a photo, so publishing
 * follows straight on, with one short wait and retry if Meta says it is
 * still processing.
 */
export async function publishPhotoToInstagram(input: { organizationId: string; imageUrl: string; caption: string }): Promise<PublishResult> {
  const page = await target(input.organizationId);
  if (!page?.instagramId) {
    const failure: PublishFailure = { kind: "not_connected", retry: true, reason: "Instagram isn't linked to the posting page." };
    return { ok: false, message: failure.reason, failure };
  }
  if (await inDemo()) return { ok: false, message: DEMO_BLOCKED, failure: { kind: "permission", retry: false, reason: DEMO_BLOCKED } };

  const made = await graphPost(`/${page.instagramId}/media`, { image_url: input.imageUrl, caption: input.caption.slice(0, 2200), access_token: page.token });
  if (!made.ok) return refused("instagram", made);
  const creationId = made.json.id ?? "";

  let published = await graphPost(`/${page.instagramId}/media_publish`, { creation_id: creationId, access_token: page.token });
  if (!published.ok && (published.code === 9007 || published.subcode === 2207027)) {
    // "Media ID is not available": still processing.
    await new Promise((r) => setTimeout(r, 5_000));
    published = await graphPost(`/${page.instagramId}/media_publish`, { creation_id: creationId, access_token: page.token });
  }
  if (!published.ok) return refused("instagram", published);
  const postId = published.json.id ?? "";
  log.info("instagram.published", { postId });
  return { ok: true, postId };
}
