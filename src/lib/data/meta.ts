import { createAdminClient } from "@/lib/supabase/admin";
import { contactName, listPages, subscribePage } from "@/lib/meta/graph";
import type { IncomingMessage } from "@/lib/meta/webhook";
import type { Database } from "@/lib/supabase/database.types";

/**
 * The Facebook and Instagram connection, read and written as the server.
 *
 * Every key lives in meta_settings and meta_pages, which no signed-in person
 * can read (no policy grants it). What leaves this file for a page to show is
 * whether a key is there, never the key.
 */

export const META_ROLES = ["posting", "inbox", "collector"] as const;
export type MetaRole = (typeof META_ROLES)[number];

export interface MetaSetup {
  appId: string | null;
  hasSecret: boolean;
  loginConfigId: string | null;
  verifyToken: string;
  connectedAt: string | null;
  webhooksAt: string | null;
  lastError: string | null;
}

export interface MetaPageRow {
  id: string;
  pageId: string;
  name: string;
  instagramId: string | null;
  instagramUsername: string | null;
  roles: MetaRole[];
  subscribedAt: string | null;
  lastError: string | null;
}

export interface MetaSecrets {
  appId: string;
  appSecret: string;
  loginConfigId: string | null;
  verifyToken: string;
  userToken: string | null;
}

const db = createAdminClient;

/** What the setup screen shows. Creates the row (and its verify token) the first time. */
export async function getMetaSetup(organizationId: string): Promise<MetaSetup> {
  const admin = db();
  let { data } = await admin.from("meta_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  if (!data) {
    const made = await admin.from("meta_settings").insert({ organization_id: organizationId }).select("*").single();
    data = made.data;
  }
  return {
    appId: data?.app_id ?? null,
    hasSecret: Boolean(data?.app_secret),
    loginConfigId: data?.login_config_id ?? null,
    verifyToken: data?.verify_token ?? "",
    connectedAt: data?.connected_at ?? null,
    webhooksAt: data?.webhooks_at ?? null,
    lastError: data?.last_error ?? null,
  };
}

export async function getMetaSecrets(organizationId: string): Promise<MetaSecrets | null> {
  const { data } = await db().from("meta_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  if (!data?.app_id || !data?.app_secret) return null;
  return {
    appId: data.app_id,
    appSecret: data.app_secret,
    loginConfigId: data.login_config_id ?? null,
    verifyToken: data.verify_token,
    userToken: data.user_token ?? null,
  };
}

export async function saveMetaSettings(organizationId: string, patch: Record<string, unknown>): Promise<void> {
  await getMetaSetup(organizationId);
  const { error } = await db()
    .from("meta_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId);
  if (error) throw new Error(error.message);
}

function toPage(row: Database["public"]["Tables"]["meta_pages"]["Row"]): MetaPageRow {
  return {
    id: row.id,
    pageId: row.page_id,
    name: row.name,
    instagramId: row.instagram_id ?? null,
    instagramUsername: row.instagram_username ?? null,
    roles: (row.roles ?? []).filter((r: string): r is MetaRole => (META_ROLES as readonly string[]).includes(r)),
    subscribedAt: row.subscribed_at ?? null,
    lastError: row.last_error ?? null,
  };
}

export async function listMetaPages(organizationId: string): Promise<MetaPageRow[]> {
  const { data } = await db().from("meta_pages").select("*").eq("organization_id", organizationId).order("name");
  return (data ?? []).map(toPage);
}

/**
 * Fetch every page the owner's key can see, keep each page's own key, and
 * switch message delivery on for it. A page already here keeps its roles.
 * The first page ever connected also gets 'posting', so the week's posts have
 * somewhere to go without another click.
 */
export async function syncMetaPages(organizationId: string, userToken: string): Promise<{ pages: number; failed: number }> {
  const admin = db();
  const pages = await listPages(userToken);
  const { data: existing } = await admin.from("meta_pages").select("page_id, roles").eq("organization_id", organizationId);
  const known = new Map<string, string[]>((existing ?? []).map((r: { page_id: string; roles: string[] }) => [r.page_id, r.roles]));
  const firstEver = known.size === 0;
  let failed = 0;

  for (const [i, page] of pages.entries()) {
    let subscribedAt: string | null = null;
    let lastError: string | null = null;
    try {
      await subscribePage(page.id, page.access_token);
      subscribedAt = new Date().toISOString();
    } catch (err) {
      failed += 1;
      lastError = err instanceof Error ? err.message : "Facebook refused the subscription.";
    }
    const roles = known.get(page.id) ?? (firstEver && i === 0 ? ["posting", "inbox"] : ["inbox"]);
    const { error } = await admin.from("meta_pages").upsert(
      {
        organization_id: organizationId,
        page_id: page.id,
        name: page.name,
        access_token: page.access_token,
        instagram_id: page.instagram_business_account?.id ?? null,
        instagram_username: page.instagram_business_account?.username ?? null,
        roles,
        subscribed_at: subscribedAt,
        last_error: lastError,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,page_id" }
    );
    if (error) throw new Error(error.message);
  }
  return { pages: pages.length, failed };
}

export async function setMetaPageRoles(organizationId: string, rowId: string, roles: MetaRole[]): Promise<void> {
  const admin = db();
  // One page posts the week's posts: ticking it here unticks it elsewhere.
  if (roles.includes("posting")) {
    const { data: others } = await admin.from("meta_pages").select("id, roles").eq("organization_id", organizationId).neq("id", rowId);
    for (const other of others ?? []) {
      if ((other.roles ?? []).includes("posting")) {
        await admin
          .from("meta_pages")
          .update({ roles: other.roles.filter((r: string) => r !== "posting") })
          .eq("id", other.id);
      }
    }
  }
  const { error } = await admin
    .from("meta_pages")
    .update({ roles, updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("id", rowId);
  if (error) throw new Error(error.message);
}

export async function removeMetaPage(organizationId: string, rowId: string): Promise<void> {
  const { error } = await db().from("meta_pages").delete().eq("organization_id", organizationId).eq("id", rowId);
  if (error) throw new Error(error.message);
}

/** The page the week's posts go to, with its key. */
export async function postingPage(organizationId: string): Promise<{ pageId: string; token: string } | null> {
  const { data } = await db()
    .from("meta_pages")
    .select("page_id, access_token")
    .eq("organization_id", organizationId)
    .contains("roles", ["posting"])
    .limit(1)
    .maybeSingle();
  return data ? { pageId: data.page_id, token: data.access_token } : null;
}

/** Whether any business has a page ticked for posting, so the posting cron has somewhere to go. */
export async function anyPostingPage(): Promise<boolean> {
  const { data } = await db().from("meta_pages").select("id").contains("roles", ["posting"]).limit(1);
  return (data ?? []).length > 0;
}

/** The connected page a delivery is for, by its page id or its Instagram id. */
export async function pageForAccount(accountId: string): Promise<{
  id: string;
  organizationId: string;
  pageId: string;
  token: string;
  roles: string[];
} | null> {
  const admin = db();
  const { data } = await admin
    .from("meta_pages")
    .select("id, organization_id, page_id, access_token, roles")
    .or(`page_id.eq.${accountId.replace(/[^0-9]/g, "")},instagram_id.eq.${accountId.replace(/[^0-9]/g, "")}`)
    .limit(1)
    .maybeSingle();
  return data ? { id: data.id, organizationId: data.organization_id, pageId: data.page_id, token: data.access_token, roles: data.roles ?? [] } : null;
}

export async function appSecretFor(organizationId: string): Promise<string | null> {
  const { data } = await db().from("meta_settings").select("app_secret").eq("organization_id", organizationId).maybeSingle();
  return data?.app_secret ?? null;
}

/** Whether any business has this verify token, for Meta's check of the address. */
export async function verifyTokenKnown(token: string): Promise<boolean> {
  if (!token) return false;
  const { data } = await db().from("meta_settings").select("organization_id").eq("verify_token", token).limit(1);
  return (data ?? []).length > 0;
}

/**
 * Keep one delivered message. A message Meta delivers twice is kept once (the
 * mid is unique). Returns whether it was new, so the alert is sent once too.
 */
export async function storeMetaMessage(
  page: { id: string; organizationId: string; token: string },
  message: IncomingMessage
): Promise<{ isNew: boolean; contactName: string | null }> {
  const admin = db();
  const { data: earlier } = await admin
    .from("meta_messages")
    .select("contact_name")
    .eq("page_row_id", page.id)
    .eq("contact_id", message.contactId)
    .not("contact_name", "is", null)
    .limit(1)
    .maybeSingle();
  const name = earlier?.contact_name ?? (await contactName(message.contactId, page.token, message.platform));

  const { data, error } = await admin
    .from("meta_messages")
    .upsert(
      {
        organization_id: page.organizationId,
        page_row_id: page.id,
        platform: message.platform,
        contact_id: message.contactId,
        contact_name: name,
        direction: message.direction,
        body: message.text,
        attachments: message.attachments,
        mid: message.mid,
        created_at: message.at.toISOString(),
      },
      { onConflict: "mid", ignoreDuplicates: true }
    )
    .select("id");
  if (error) throw new Error(error.message);
  return { isNew: (data ?? []).length > 0, contactName: name };
}

export interface MetaThread {
  key: string;
  pageRowId: string;
  pageName: string;
  platform: "facebook" | "instagram";
  contactId: string;
  contactName: string | null;
  lastBody: string | null;
  lastAt: string;
  lastIncomingAt: string | null;
  unread: number;
}

export interface MetaMessage {
  id: string;
  direction: "in" | "out";
  body: string | null;
  attachments: { type: string; url: string | null; title: string | null }[];
  createdAt: string;
}

/** Conversations, newest first, built from the last 1,000 messages. */
export async function listMetaThreads(organizationId: string): Promise<MetaThread[]> {
  const admin = db();
  const [{ data: rows }, pages] = await Promise.all([
    admin
      .from("meta_messages")
      .select("page_row_id, platform, contact_id, contact_name, direction, body, read_at, created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(1000),
    listMetaPages(organizationId),
  ]);
  const names = new Map(pages.map((p) => [p.id, p.name]));
  const threads = new Map<string, MetaThread>();
  for (const r of rows ?? []) {
    const key = `${r.page_row_id}:${r.platform}:${r.contact_id}`;
    let t = threads.get(key);
    if (!t) {
      t = {
        key,
        pageRowId: r.page_row_id,
        pageName: names.get(r.page_row_id) ?? "Page",
        platform: r.platform as MetaThread["platform"],
        contactId: r.contact_id,
        contactName: r.contact_name,
        lastBody: r.body,
        lastAt: r.created_at,
        lastIncomingAt: null,
        unread: 0,
      };
      threads.set(key, t);
    }
    if (!t.contactName && r.contact_name) t.contactName = r.contact_name;
    if (r.direction === "in") {
      if (!t.lastIncomingAt) t.lastIncomingAt = r.created_at;
      if (!r.read_at) t.unread += 1;
    }
  }
  return [...threads.values()];
}

export async function threadMessages(
  organizationId: string,
  thread: { pageRowId: string; platform: string; contactId: string }
): Promise<MetaMessage[]> {
  const { data } = await db()
    .from("meta_messages")
    .select("id, direction, body, attachments, created_at")
    .eq("organization_id", organizationId)
    .eq("page_row_id", thread.pageRowId)
    .eq("platform", thread.platform)
    .eq("contact_id", thread.contactId)
    .order("created_at", { ascending: true })
    .limit(200);
  return (data ?? []).map((m) => ({
    id: m.id,
    direction: m.direction as MetaMessage["direction"],
    body: m.body,
    attachments: m.attachments ?? [],
    createdAt: m.created_at,
  }));
}

export async function pageToken(organizationId: string, rowId: string): Promise<{ pageId: string; token: string } | null> {
  const { data } = await db()
    .from("meta_pages")
    .select("page_id, access_token")
    .eq("organization_id", organizationId)
    .eq("id", rowId)
    .maybeSingle();
  return data ? { pageId: data.page_id, token: data.access_token } : null;
}

export async function recordSent(input: {
  organizationId: string;
  pageRowId: string;
  platform: string;
  contactId: string;
  contactName: string | null;
  body: string;
  mid: string | null;
  sentBy: string;
}): Promise<void> {
  const { error } = await db()
    .from("meta_messages")
    .upsert(
      {
        organization_id: input.organizationId,
        page_row_id: input.pageRowId,
        platform: input.platform,
        contact_id: input.contactId,
        contact_name: input.contactName,
        direction: "out",
        body: input.body,
        mid: input.mid,
        sent_by: input.sentBy,
      },
      { onConflict: "mid", ignoreDuplicates: true }
    );
  if (error) throw new Error(error.message);
}

export async function markThreadRead(
  organizationId: string,
  thread: { pageRowId: string; platform: string; contactId: string }
): Promise<void> {
  await db()
    .from("meta_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("page_row_id", thread.pageRowId)
    .eq("platform", thread.platform)
    .eq("contact_id", thread.contactId)
    .eq("direction", "in")
    .is("read_at", null);
}
