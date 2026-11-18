/**
 * The few calls to Meta's Graph API that connecting the business page and
 * scheduling its posts need, and nothing else.
 *
 * Every call returns its answer or throws a GraphError carrying Meta's own
 * message, because "Facebook said no" is useless and "(#200) The user hasn't
 * authorized the application to perform this action" says what to fix. Keys
 * are sent as parameters and never logged.
 *
 * Scheduling uses Meta's own scheduled posts (published=false with a
 * scheduled_publish_time), so a post sits in the page's Planner in Meta
 * Business Suite and Meta puts it out on the day. Nothing drives a browser.
 */

export const GRAPH_VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** What "Connect Facebook" asks for: list the pages and post to them. */
export const META_PERMISSIONS = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "business_management"] as const;

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null
  ) {
    super(message);
  }
}

type Params = Record<string, string | number | boolean | undefined | null>;

function query(params: Params): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) q.set(k, String(v));
  return q.toString();
}

async function call<T>(method: "GET" | "POST", path: string, params: Params, body?: unknown): Promise<T> {
  const response = await fetch(`${GRAPH}${path}?${query(params)}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = (await response.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!response.ok || json.error) {
    throw new GraphError(json.error?.message ?? `Facebook answered ${response.status}.`, response.status, json.error?.code ?? null);
  }
  return json;
}

/** Where the owner is sent to pick their page. */
export function loginDialogUrl(input: { appId: string; redirectUri: string; state: string; configId?: string | null }): string {
  const params: Params = { client_id: input.appId, redirect_uri: input.redirectUri, state: input.state, response_type: "code" };
  if (input.configId?.trim()) params.config_id = input.configId.trim();
  else params.scope = META_PERMISSIONS.join(",");
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${query(params)}`;
}

/** The code Facebook sent back, for the owner's key, and that key for one that lasts about 60 days. */
export async function userTokenFromCode(input: { appId: string; appSecret: string; redirectUri: string; code: string }): Promise<string> {
  const short = await call<{ access_token: string }>("GET", "/oauth/access_token", {
    client_id: input.appId,
    client_secret: input.appSecret,
    redirect_uri: input.redirectUri,
    code: input.code,
  });
  const long = await call<{ access_token: string }>("GET", "/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: input.appId,
    client_secret: input.appSecret,
    fb_exchange_token: short.access_token,
  });
  return long.access_token;
}

export interface GraphPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
}

/** Every page the owner looks after, each with its own key (which does not expire). */
export async function listPages(userToken: string): Promise<GraphPage[]> {
  const pages: GraphPage[] = [];
  let after: string | undefined;
  for (let i = 0; i < 10; i += 1) {
    const page = await call<{ data: GraphPage[]; paging?: { cursors?: { after?: string }; next?: string } }>("GET", "/me/accounts", {
      fields: "id,name,access_token,instagram_business_account{id,username}",
      limit: 100,
      after,
      access_token: userToken,
    });
    pages.push(...(page.data ?? []));
    if (!page.paging?.next || !page.paging.cursors?.after) break;
    after = page.paging.cursors.after;
  }
  return pages;
}

/**
 * Schedule a photo post on the page. One picture is a photo post; two or more
 * (a before and an after) are uploaded unpublished first and attached to one
 * scheduled feed post, so they show side by side.
 */
export async function schedulePhotoPost(input: {
  pageId: string;
  pageToken: string;
  imageUrls: string[];
  caption: string;
  at: Date;
}): Promise<string> {
  const when = Math.floor(input.at.getTime() / 1000);
  if (input.imageUrls.length === 0) throw new GraphError("There's no picture to post.", 400, null);
  if (input.imageUrls.length === 1) {
    const made = await call<{ id?: string; post_id?: string }>("POST", `/${input.pageId}/photos`, {
      url: input.imageUrls[0],
      message: input.caption,
      published: false,
      scheduled_publish_time: when,
      access_token: input.pageToken,
    });
    return made.post_id ?? made.id ?? "";
  }
  const media: { media_fbid: string }[] = [];
  for (const url of input.imageUrls) {
    const photo = await call<{ id: string }>("POST", `/${input.pageId}/photos`, {
      url,
      published: false,
      temporary: true,
      access_token: input.pageToken,
    });
    media.push({ media_fbid: photo.id });
  }
  const post = await call<{ id: string }>(
    "POST",
    `/${input.pageId}/feed`,
    { access_token: input.pageToken },
    { message: input.caption, attached_media: media, published: false, scheduled_publish_time: when }
  );
  return post.id;
}
