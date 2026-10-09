"use server";

import { revalidatePath } from "next/cache";

import type { Profile } from "@/types/domain";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { refuseInDemo } from "@/lib/demo-mode";
import { outboundBaseUrl } from "@/lib/base-url";
import { GraphError, sendMessage, subscribeApp } from "@/lib/meta/graph";
import { insideReplyWindow } from "@/lib/meta/webhook";
import {
  getMetaSecrets,
  listMetaThreads,
  markThreadRead,
  META_ROLES,
  pageToken,
  recordSent,
  removeMetaPage,
  saveMetaSettings,
  setMetaPageRoles,
  syncMetaPages,
  threadMessages,
  type MetaMessage,
  type MetaRole,
} from "@/lib/data/meta";

/**
 * Admin > Facebook & Instagram.
 *
 * Only the owner level connects pages or changes what they are for: a page
 * key can post as the business. Replying is open to anyone who can open the
 * page, the same as answering a text.
 */

const PATH = "/admin/meta";

export type MetaResult<T = undefined> = { ok: true; value?: T } | { ok: false; error: string };

function reason(err: unknown): string {
  if (err instanceof GraphError) return `Facebook said: ${err.message}`;
  return err instanceof Error ? err.message : "Something went wrong.";
}

async function owner(): Promise<{ profile: Profile; error?: undefined } | { error: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { error: "Sign in again." };
  if (!isOwnerLevel(profile.roles)) return { error: "Only an owner can change the Facebook connection." };
  return { profile };
}

/** The Meta app's id and secret, pasted once. A blank secret keeps the saved one. */
export async function saveMetaApp(input: { appId: string; appSecret: string; loginConfigId: string }): Promise<MetaResult> {
  const who = await owner();
  if (who.error !== undefined) return { ok: false, error: who.error };
  await refuseInDemo();

  const appId = input.appId.trim();
  if (!/^\d{5,20}$/.test(appId)) return { ok: false, error: "The App ID is a number, found at the top of the app's Dashboard." };
  const secret = input.appSecret.trim();
  if (secret && !/^[0-9a-f]{32}$/i.test(secret)) return { ok: false, error: "The App secret is 32 letters and numbers, from App settings → Basic." };
  const config = input.loginConfigId.trim();
  if (config && !/^\d{5,20}$/.test(config)) return { ok: false, error: "The configuration ID is a number, from Facebook Login for Business → Configurations." };

  try {
    await saveMetaSettings(who.profile.organization_id, {
      app_id: appId,
      ...(secret ? { app_secret: secret } : {}),
      login_config_id: config || null,
      last_error: null,
    });
  } catch (err) {
    return { ok: false, error: reason(err) };
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** Fetch the pages again with the saved key, and switch message delivery back on. */
export async function refreshMetaPages(): Promise<MetaResult<{ pages: number; failed: number }>> {
  const who = await owner();
  if (who.error !== undefined) return { ok: false, error: who.error };
  await refuseInDemo();
  const orgId = who.profile.organization_id;
  const secrets = await getMetaSecrets(orgId);
  if (!secrets?.userToken) return { ok: false, error: "Press Connect Facebook first." };

  try {
    const result = await syncMetaPages(orgId, secrets.userToken);
    const base = (await outboundBaseUrl()).replace(/\/$/, "");
    await subscribeApp({
      appId: secrets.appId,
      appSecret: secrets.appSecret,
      callbackUrl: `${base}/api/webhooks/meta`,
      verifyToken: secrets.verifyToken,
    });
    await saveMetaSettings(orgId, { webhooks_at: new Date().toISOString(), last_error: null });
    revalidatePath(PATH);
    return { ok: true, value: result };
  } catch (err) {
    const message = reason(err);
    await saveMetaSettings(orgId, { last_error: message }).catch(() => undefined);
    revalidatePath(PATH);
    return { ok: false, error: message };
  }
}

export async function setPageRoles(input: { rowId: string; roles: string[] }): Promise<MetaResult> {
  const who = await owner();
  if (who.error !== undefined) return { ok: false, error: who.error };
  await refuseInDemo();
  const roles = input.roles.filter((r): r is MetaRole => (META_ROLES as readonly string[]).includes(r));
  try {
    await setMetaPageRoles(who.profile.organization_id, input.rowId, roles);
  } catch (err) {
    return { ok: false, error: reason(err) };
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** Forget a page here. It stays connected on Facebook's side until removed there. */
export async function forgetPage(rowId: string): Promise<MetaResult> {
  const who = await owner();
  if (who.error !== undefined) return { ok: false, error: who.error };
  await refuseInDemo();
  try {
    await removeMetaPage(who.profile.organization_id, rowId);
  } catch (err) {
    return { ok: false, error: reason(err) };
  }
  revalidatePath(PATH);
  return { ok: true };
}

type ThreadRef = { pageRowId: string; platform: string; contactId: string };

/** One conversation's messages, marked read as they are opened. */
export async function openThread(thread: ThreadRef): Promise<MetaResult<MetaMessage[]>> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Sign in again." };
  const messages = await threadMessages(profile.organization_id, thread);
  await markThreadRead(profile.organization_id, thread);
  return { ok: true, value: messages };
}

/** A reply from the page, inside Meta's 24-hour window. */
export async function sendMetaReply(input: ThreadRef & { text: string }): Promise<MetaResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Sign in again." };
  await refuseInDemo();
  const text = input.text.trim();
  if (!text) return { ok: false, error: "Write a reply first." };
  if (text.length > 2000) return { ok: false, error: "Facebook takes up to 2,000 characters in one message." };

  const orgId = profile.organization_id;
  const thread = (await listMetaThreads(orgId)).find(
    (t) => t.pageRowId === input.pageRowId && t.platform === input.platform && t.contactId === input.contactId
  );
  if (!thread) return { ok: false, error: "That conversation isn't here any more." };
  if (!insideReplyWindow(thread.lastIncomingAt ? new Date(thread.lastIncomingAt) : null)) {
    return { ok: false, error: "It's been more than 24 hours since they last wrote, so Facebook won't deliver a reply from an app. Answer from the Facebook or Instagram app." };
  }

  const page = await pageToken(orgId, input.pageRowId);
  if (!page) return { ok: false, error: "That page isn't connected any more." };
  try {
    const mid = await sendMessage({ pageId: page.pageId, pageToken: page.token, recipientId: input.contactId, text });
    await recordSent({
      organizationId: orgId,
      pageRowId: input.pageRowId,
      platform: input.platform,
      contactId: input.contactId,
      contactName: thread.contactName,
      body: text,
      mid,
      sentBy: profile.id,
    });
  } catch (err) {
    return { ok: false, error: reason(err) };
  }
  revalidatePath(PATH);
  return { ok: true };
}
