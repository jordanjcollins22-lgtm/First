import { createAdminClient } from "@/lib/supabase/admin";
import { listPages } from "@/lib/meta/graph";

/**
 * The business's Facebook page connection, read and written as the server.
 *
 * Keys live in meta_settings and meta_pages, which no signed-in person can
 * read (no policy grants it). What leaves this file for a screen is whether
 * a key is there, never the key.
 */

export interface MetaSecrets {
  appId: string;
  appSecret: string;
  loginConfigId: string | null;
}

export interface MetaStatus {
  appSaved: boolean;
  connected: boolean;
  pageName: string | null;
  lastError: string | null;
}

const db = createAdminClient;

async function ensureRow(organizationId: string): Promise<void> {
  const admin = db();
  const { data } = await admin.from("meta_settings").select("organization_id").eq("organization_id", organizationId).maybeSingle();
  if (!data) await admin.from("meta_settings").insert({ organization_id: organizationId });
}

export async function getMetaSecrets(organizationId: string): Promise<MetaSecrets | null> {
  const { data } = await db().from("meta_settings").select("app_id, app_secret, login_config_id").eq("organization_id", organizationId).maybeSingle();
  if (!data?.app_id || !data?.app_secret) return null;
  return { appId: data.app_id, appSecret: data.app_secret, loginConfigId: data.login_config_id ?? null };
}

export async function saveMetaSettings(organizationId: string, patch: Record<string, unknown>): Promise<void> {
  await ensureRow(organizationId);
  const { error } = await db()
    .from("meta_settings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId);
  if (error) throw new Error(error.message);
}

/**
 * Keep every page the owner's key can see, each with its own key. A page
 * already here keeps its roles; the first page ever connected is the one
 * posts go to.
 */
export async function syncMetaPages(organizationId: string, userToken: string): Promise<number> {
  const admin = db();
  const pages = await listPages(userToken);
  const { data: existing } = await admin.from("meta_pages").select("page_id, roles").eq("organization_id", organizationId);
  const known = new Map<string, string[]>((existing ?? []).map((r: { page_id: string; roles: string[] }) => [r.page_id, r.roles]));
  const anyPosting = [...known.values()].some((roles) => roles.includes("posting"));
  for (const [i, page] of pages.entries()) {
    const roles = known.get(page.id) ?? (!anyPosting && i === 0 ? ["posting"] : ["inbox"]);
    const { error } = await admin.from("meta_pages").upsert(
      {
        organization_id: organizationId,
        page_id: page.id,
        name: page.name,
        access_token: page.access_token,
        instagram_id: page.instagram_business_account?.id ?? null,
        instagram_username: page.instagram_business_account?.username ?? null,
        roles,
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,page_id" }
    );
    if (error) throw new Error(error.message);
  }
  return pages.length;
}

/** The page posts go to, with its key. */
export async function postingPage(organizationId: string): Promise<{ pageId: string; token: string; name: string } | null> {
  const { data } = await db()
    .from("meta_pages")
    .select("page_id, access_token, name")
    .eq("organization_id", organizationId)
    .contains("roles", ["posting"])
    .limit(1)
    .maybeSingle();
  return data ? { pageId: data.page_id, token: data.access_token, name: data.name } : null;
}

export async function metaStatus(organizationId: string): Promise<MetaStatus> {
  const [{ data: settings }, page] = await Promise.all([
    db().from("meta_settings").select("app_id, app_secret, last_error").eq("organization_id", organizationId).maybeSingle(),
    postingPage(organizationId),
  ]);
  return {
    appSaved: Boolean(settings?.app_id && settings?.app_secret),
    connected: Boolean(page),
    pageName: page?.name ?? null,
    lastError: settings?.last_error ?? null,
  };
}
