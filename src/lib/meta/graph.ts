/**
 * The few calls to Meta's Graph API the connection needs, and nothing else.
 *
 * Every call returns its answer or throws a GraphError carrying Meta's own
 * message, because "Facebook said no" is useless and "(#200) The user hasn't
 * authorized the application to perform this action" says what to fix. Keys
 * are sent as parameters and never logged.
 */

export const GRAPH_VERSION = "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** What "Connect Facebook" asks for when there's no saved login configuration. */
export const META_PERMISSIONS = [
  "pages_show_list",
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_messaging",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_manage_messages",
  "business_management",
] as const;

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

async function call<T>(method: "GET" | "POST" | "DELETE", path: string, params: Params, body?: unknown): Promise<T> {
  const url = `${GRAPH}${path}?${query(params)}`;
  const response = await fetch(url, {
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

/** Where the owner is sent to pick their pages. */
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

/**
 * Every page the owner looks after, each with its own key. A page key made
 * from a long-lived user key does not expire.
 */
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

/** Messages to this page (and its Instagram) are sent to the app from now on. */
export async function subscribePage(pageId: string, pageToken: string): Promise<void> {
  await call("POST", `/${pageId}/subscribed_apps`, {
    subscribed_fields: "messages,messaging_postbacks,message_reads",
    access_token: pageToken,
  });
}

/**
 * Tell Meta where to deliver page and Instagram messages for the whole app.
 * Meta checks the address straight away, so the app must already answer it.
 */
export async function subscribeApp(input: { appId: string; appSecret: string; callbackUrl: string; verifyToken: string }): Promise<void> {
  const appToken = `${input.appId}|${input.appSecret}`;
  for (const [object, fields] of [
    ["page", "messages,messaging_postbacks,message_reads"],
    ["instagram", "messages"],
  ] as const) {
    await call("POST", `/${input.appId}/subscriptions`, {
      object,
      callback_url: input.callbackUrl,
      fields,
      verify_token: input.verifyToken,
      include_values: true,
      access_token: appToken,
    });
  }
}

/** A reply in a Messenger or Instagram conversation, from the page. */
export async function sendMessage(input: { pageId: string; pageToken: string; recipientId: string; text: string }): Promise<string | null> {
  const sent = await call<{ message_id?: string }>(
    "POST",
    `/${input.pageId}/messages`,
    { access_token: input.pageToken },
    { recipient: { id: input.recipientId }, messaging_type: "RESPONSE", message: { text: input.text } }
  );
  return sent.message_id ?? null;
}

/** Who somebody is, as far as the page is allowed to know. Null when Meta won't say. */
export async function contactName(contactId: string, pageToken: string, platform: "facebook" | "instagram"): Promise<string | null> {
  try {
    const fields = platform === "instagram" ? "name,username" : "name";
    const who = await call<{ name?: string; username?: string }>("GET", `/${contactId}`, { fields, access_token: pageToken });
    return who.name || who.username || null;
  } catch {
    return null;
  }
}

/** One photo post on a page, from a picture's address. */
export async function publishPhoto(input: { pageId: string; pageToken: string; imageUrl: string; caption: string }): Promise<string> {
  const posted = await call<{ id?: string; post_id?: string }>("POST", `/${input.pageId}/photos`, {
    url: input.imageUrl,
    message: input.caption,
    access_token: input.pageToken,
  });
  return posted.post_id ?? posted.id ?? "";
}
