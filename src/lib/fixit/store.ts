import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import type { BuildStatus, TicketStatus } from "@/lib/fixit/messages";

/**
 * Reading and writing fix-it tickets and builds (migration 0368). Server
 * only, with the service role: signed-in admins may only read these tables.
 * Callers check who is asking (a signed Discord request from the configured
 * application, or an owner in the app) before calling.
 */

export const FIXIT_BUCKET = "fixit-screenshots";
/** The build job fetches the screenshot whenever it gets to the ticket, so the link lasts a year. */
const SCREENSHOT_LINK_SECONDS = 60 * 60 * 24 * 365;

export interface FixitTicket {
  id: string;
  number: number;
  description: string;
  screenshot_path: string | null;
  discord_user: string | null;
  status: TicketStatus;
  result: string | null;
  owner_note: string | null;
  build_id: string | null;
  created_at: string;
}

export interface FixitBuild {
  id: string;
  organization_id: string;
  number: number;
  status: BuildStatus;
  requested_by: string | null;
  branch: string | null;
  preview_url: string | null;
  summary: string | null;
  notified_at: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface DiscordConfig {
  organizationId: string;
  applicationId: string;
  publicKey: string;
  botToken: string | null;
  webhookUrl: string | null;
  guildId: string | null;
  channelId: string | null;
}

type Outcome<T> = ({ ok: true } & T) | { ok: false; error: string };

const db = () => createAdminClient() as unknown as SupabaseClient;
const TICKET_COLUMNS = "id,number,description,screenshot_path,discord_user,status,result,owner_note,build_id,created_at";
const BUILD_COLUMNS = "id,organization_id,number,status,requested_by,branch,preview_url,summary,notified_at,approved_at,created_at";
/** Tickets the next build takes: new ones and ones the owner sent back. */
const BUILDABLE: TicketStatus[] = ["open", "sent_back"];

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function toConfig(row: { organization_id: string; secrets: Record<string, string> | null; settings: Record<string, unknown> | null }): DiscordConfig | null {
  const settings = row.settings ?? {};
  const secrets = row.secrets ?? {};
  const applicationId = text(settings.application_id);
  const publicKey = text(settings.public_key);
  if (!applicationId || !publicKey) return null;
  return {
    organizationId: row.organization_id,
    applicationId,
    publicKey,
    botToken: text(secrets.bot_token),
    webhookUrl: text(secrets.webhook_url),
    guildId: text(settings.guild_id),
    channelId: text(settings.channel_id),
  };
}

/** The business whose saved Discord application is this one, with its keys. */
export async function discordConfigForApplication(applicationId: string): Promise<DiscordConfig | null> {
  if (!/^\d{5,25}$/.test(applicationId)) return null;
  const { data } = await db()
    .from("integration_credentials")
    .select("organization_id,secrets,settings")
    .eq("provider", "discord")
    .eq("settings->>application_id", applicationId)
    .limit(1);
  const row = (data ?? [])[0];
  return row ? toConfig(row) : null;
}

export async function discordConfigForOrg(organizationId: string): Promise<DiscordConfig | null> {
  const { data } = await db()
    .from("integration_credentials")
    .select("organization_id,secrets,settings")
    .eq("provider", "discord")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data ? toConfig(data) : null;
}

/** Keeps a screenshot in the private bucket, under the business's folder, and a year-long link to it. */
export async function storeScreenshot(organizationId: string, bytes: ArrayBuffer, contentType: string, extension: string): Promise<{ path: string; url: string | null }> {
  const storage = db().storage.from(FIXIT_BUCKET);
  const path = `${organizationId}/${new Date().toISOString().slice(0, 10)}-${randomUUID()}.${extension}`;
  const { error } = await storage.upload(path, bytes, { contentType, upsert: false });
  if (error) throw error;
  const { data } = await storage.createSignedUrl(path, SCREENSHOT_LINK_SECONDS);
  return { path, url: data?.signedUrl ?? null };
}

/** Short-lived links for the panel's thumbnails, by path. */
export async function screenshotLinks(paths: string[], seconds = 60 * 10): Promise<Map<string, string>> {
  if (!paths.length) return new Map();
  const { data } = await db().storage.from(FIXIT_BUCKET).createSignedUrls(paths, seconds);
  return new Map((data ?? []).flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as [string, string]] : [])));
}

/** Saves a ticket; the database numbers it. Retries if two land at once and collide on the number. */
export async function createTicket(
  organizationId: string,
  ticket: { description: string; screenshotPath: string | null; screenshotUrl: string | null; discordUser: string | null }
): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await db()
      .from("fixit_tickets")
      .insert({
        organization_id: organizationId,
        description: ticket.description,
        screenshot_path: ticket.screenshotPath,
        screenshot_url: ticket.screenshotUrl,
        discord_user: ticket.discordUser,
      })
      .select("number")
      .single();
    if (!error) return (data as { number: number }).number;
    if (error.code !== "23505" || attempt >= 2) throw error;
  }
}

/** Every ticket that isn't closed, oldest first. */
export async function listOpenTickets(organizationId: string): Promise<FixitTicket[]> {
  const { data, error } = await db()
    .from("fixit_tickets")
    .select(TICKET_COLUMNS)
    .eq("organization_id", organizationId)
    .neq("status", "closed")
    .order("number", { ascending: true })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as FixitTicket[];
}

export async function ticketsInBuild(buildId: string): Promise<FixitTicket[]> {
  const { data, error } = await db().from("fixit_tickets").select(TICKET_COLUMNS).eq("build_id", buildId).order("number", { ascending: true });
  if (error) throw error;
  return (data ?? []) as FixitTicket[];
}

export async function latestBuild(organizationId: string): Promise<FixitBuild | null> {
  const { data } = await db()
    .from("fixit_builds")
    .select(BUILD_COLUMNS)
    .eq("organization_id", organizationId)
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as FixitBuild | null) ?? null;
}

/**
 * Queues one build of every open and sent-back ticket. Refused while a build
 * is queued or running (a partial unique index backs this up if two land at
 * once), or when there's nothing to build.
 */
export async function queueBuild(organizationId: string, requestedBy: string | null): Promise<Outcome<{ number: number; tickets: number }>> {
  const { data: active } = await db()
    .from("fixit_builds")
    .select("number,status")
    .eq("organization_id", organizationId)
    .in("status", ["queued", "running"])
    .limit(1);
  const busy = (active ?? [])[0] as { number: number; status: string } | undefined;
  if (busy) return { ok: false, error: `Build #${busy.number} is already ${busy.status}. Wait for its summary first.` };

  const { count } = await db()
    .from("fixit_tickets")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("status", BUILDABLE);
  if (!count) return { ok: false, error: "No open tickets to build. Add one with /fixit." };

  const { data: build, error } = await db()
    .from("fixit_builds")
    .insert({ organization_id: organizationId, requested_by: requestedBy })
    .select("id,number")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "A build is already queued. Wait for its summary first." };
    throw error;
  }
  const { id, number } = build as { id: string; number: number };

  const { data: taken, error: takeError } = await db()
    .from("fixit_tickets")
    .update({ status: "building", build_id: id })
    .eq("organization_id", organizationId)
    .in("status", BUILDABLE)
    .select("id");
  if (takeError) throw takeError;
  return { ok: true, number, tickets: (taken ?? []).length };
}

/** Marks the latest ready build approved, and closes the tickets it fixed. */
export async function approveLatestBuild(organizationId: string): Promise<Outcome<{ number: number; previewUrl: string | null }>> {
  const { data } = await db()
    .from("fixit_builds")
    .select(BUILD_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("status", "ready")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const build = data as FixitBuild | null;
  if (!build) return { ok: false, error: "There's no ready build to approve." };

  const now = new Date().toISOString();
  const { data: approved, error } = await db()
    .from("fixit_builds")
    .update({ status: "approved", approved_at: now })
    .eq("id", build.id)
    .eq("status", "ready")
    .select("id");
  if (error) throw error;
  if (!(approved ?? []).length) return { ok: false, error: "That build changed while approving. Try again." };
  await db().from("fixit_tickets").update({ status: "closed" }).eq("build_id", build.id).eq("status", "fixed");
  return { ok: true, number: build.number, previewUrl: build.preview_url };
}

/** Reopens one ticket with the owner's note on what's still wrong; the next build takes it. */
export async function sendBackTicket(organizationId: string, number: number, note: string): Promise<Outcome<{ number: number }>> {
  if (!Number.isInteger(number) || number < 1) return { ok: false, error: "Give the ticket's number." };
  const trimmed = note.trim().slice(0, 2000);
  if (!trimmed) return { ok: false, error: "Say what's still wrong in the note." };
  const { data, error } = await db()
    .from("fixit_tickets")
    .update({ status: "sent_back", owner_note: trimmed })
    .eq("organization_id", organizationId)
    .eq("number", number)
    .select("number");
  if (error) throw error;
  if (!(data ?? []).length) return { ok: false, error: `There's no ticket #${number}.` };
  return { ok: true, number };
}

/** Builds that finished (ready or failed) and haven't been posted to Discord yet. */
export async function buildsToNotify(): Promise<FixitBuild[]> {
  const { data, error } = await db()
    .from("fixit_builds")
    .select(BUILD_COLUMNS)
    .in("status", ["ready", "failed"])
    .is("notified_at", null)
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as FixitBuild[];
}

export async function markNotified(buildId: string): Promise<void> {
  const { error } = await db().from("fixit_builds").update({ notified_at: new Date().toISOString() }).eq("id", buildId);
  if (error) throw error;
}
