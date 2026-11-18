import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env, isAnthropicConfigured, isSupabaseAdminConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { activeServiceNames, readPostFromScreenshot } from "@/lib/data/read-post";
import { metaStatus, postingPage, saveMetaSettings } from "@/lib/data/meta";
import { outboundBaseUrl } from "@/lib/base-url";
import { makeCode, trackedLink } from "@/lib/outreach-links";
import { senderRoleOf } from "@/lib/referral-message";
import { facebookComment } from "@/lib/fb-comment";
import { v2RolesOf } from "@/lib/v2-roles";
import { isOwnerLevel } from "@/lib/roles";
import { GraphError, schedulePhotoPost } from "@/lib/meta/graph";
import { nextOpenSlot, readSlots } from "@/lib/social/open-day";
import { dateKeyIn, shortWhen } from "@/lib/time-zone";
import { log } from "@/lib/log";

/**
 * The lead finder extension's one door into the app.
 *
 * The extension runs in the owner's own Chrome and calls this with the app's
 * own sign-in cookie, so nothing here takes a password or a key. It asks
 * four kinds of thing:
 *
 * - check: is this Facebook post somebody in the county asking for yard work?
 * - draft / posted / skip: make a tracked link and the comment for a post,
 *   then record that the person pressed post (or that they skipped it). Every
 *   comment lands in their People you sent it to.
 * - review / decide: the before-and-after posts waiting for an OK, and the OK
 *   (photo and caption both) or a no.
 * - schedule: every approved post goes on the next open day, through Meta's
 *   own scheduled posts on the business page.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VERSION = "3.0.0";

/** social_posts and social_cadence have columns the generated types predate (0374), so they are read untyped. */
const socialDb = () => createAdminClient() as unknown as SupabaseClient;
type Json = Record<string, unknown>;

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

/** A Facebook post's address, without the tracking bits, so the same post is the same post. */
function cleanPostUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!/(^|\.)facebook\.com$/.test(url.hostname)) return null;
    const keep = new URLSearchParams();
    for (const k of ["story_fbid", "id", "fbid", "multi_permalinks"]) {
      const v = url.searchParams.get(k);
      if (v) keep.set(k, v);
    }
    const q = keep.toString();
    return `https://www.facebook.com${url.pathname.replace(/\/$/, "")}${q ? `?${q}` : ""}`;
  } catch {
    return null;
  }
}

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return fail("Sign in to app.jslandscapingmd.com in this Chrome first.", 401);
  const owner = isOwnerLevel(profile.roles);
  const meta = owner && isSupabaseAdminConfigured ? await metaStatus(profile.organization_id).catch(() => null) : null;
  const counts = owner ? await postCounts(profile.organization_id) : null;
  return NextResponse.json({
    ok: true,
    version: VERSION,
    name: profile.full_name ?? null,
    owner,
    reader: isAnthropicConfigured,
    meta,
    posts: counts,
  });
}

export async function POST(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile) return fail("Sign in to app.jslandscapingmd.com in this Chrome first.", 401);
  const body = (await request.json().catch(() => ({}))) as Json;
  try {
    switch (body.action) {
      case "check":
        return NextResponse.json(await check(profile.organization_id, body));
      case "draft":
        return NextResponse.json(await draft(profile, body));
      case "posted":
        return NextResponse.json(await posted(profile, body));
      case "skip":
        return NextResponse.json(await skip(profile, body));
    }
    if (!isOwnerLevel(profile.roles)) return fail("Only an owner can approve and schedule posts.", 403);
    if (!isSupabaseAdminConfigured) return fail("The server isn't set up for this yet.", 503);
    switch (body.action) {
      case "review":
        return NextResponse.json(await review(profile.organization_id));
      case "decide":
        return NextResponse.json(await decide(profile, body));
      case "schedule":
        return NextResponse.json(await schedule(profile.organization_id));
      case "meta-app": {
        const appId = str(body.appId, 40);
        const appSecret = str(body.appSecret, 80);
        if (!/^\d{5,25}$/.test(appId)) return fail("The App ID is the long number at the top of the Meta app's dashboard.");
        if (!/^[0-9a-f]{20,64}$/i.test(appSecret)) return fail("The App secret is under App settings → Basic in the Meta app.");
        await saveMetaSettings(profile.organization_id, { app_id: appId, app_secret: appSecret, last_error: null });
        return NextResponse.json({ ok: true });
      }
    }
    return fail("Unknown action.");
  } catch (err) {
    log.error("extension.failed", err);
    return fail(err instanceof Error ? err.message : "Something went wrong.", 500);
  }
}

/* -------------------------------------------------------------------------- */
/* Finding                                                                     */
/* -------------------------------------------------------------------------- */

async function check(organizationId: string, body: Json) {
  const text = str(body.text, 3000);
  if (!text) return { ok: true, lead: false, reason: "No words in that post." };
  const url = cleanPostUrl(str(body.url, 600));

  if (url) {
    const supabase = await createClient();
    const { data } = await supabase.from("outreach_links").select("id").eq("organization_id", organizationId).eq("post_url", url).not("posted_comment_at", "is", null).limit(1);
    if ((data ?? []).length) return { ok: true, lead: false, reason: "We already answered this one." };
  }

  // Without the reader, the extension's own keyword check stands.
  if (!isAnthropicConfigured) return { ok: true, lead: null, reason: "The post reader isn't set up, so the keyword check decides." };

  const reading = await readPostFromScreenshot({
    screenshotPath: null,
    pastedText: text,
    note: [str(body.group, 200) && `Posted in: ${str(body.group, 200)}`, str(body.when, 40) && `Facebook shows it as posted: ${str(body.when, 40)}`].filter(Boolean).join(". "),
    groupName: str(body.group, 200),
    services: await activeServiceNames(organizationId),
    blockWords: [],
  });
  if (!reading) return { ok: true, lead: null, reason: "Couldn't read it just now, so the keyword check decides." };
  return {
    ok: true,
    lead: reading.kind === "request",
    reason: reading.kind === "request" ? reading.summary : reading.kind === "promotion" ? "Someone advertising, not asking." : reading.summary,
    service: reading.service,
    author: reading.author,
    ageDays: reading.ageDays,
  };
}

type Profile = NonNullable<Awaited<ReturnType<typeof getCurrentProfile>>>;

async function draft(profile: Profile, body: Json) {
  const author = str(body.author, 80).replace(/\s+/g, " ") || null;
  const url = cleanPostUrl(str(body.url, 600));
  const group = str(body.group, 200) || null;
  const supabase = await createClient();

  if (url) {
    const { data } = await supabase
      .from("outreach_links")
      .select("id")
      .eq("organization_id", profile.organization_id)
      .eq("post_url", url)
      .not("posted_comment_at", "is", null)
      .limit(1);
    if ((data ?? []).length) return { ok: false, error: "We already answered this post." };
  }

  const [organization, baseUrl] = await Promise.all([getCurrentOrganization(), outboundBaseUrl()]);
  let code = makeCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const link = trackedLink(baseUrl, code);
    const comment = facebookComment({ author, link, business: organization.name, from: profile.full_name ?? null, role: senderRoleOf(v2RolesOf(profile)) });
    const { data, error } = await supabase
      .from("outreach_links")
      .insert({
        organization_id: profile.organization_id,
        profile_id: profile.id,
        code,
        kind: "comment",
        platform: "facebook",
        via: "referral",
        sent_to: author ?? "Someone on Facebook",
        audience: "Posted asking for help",
        from_page: group,
        post_url: url,
        note: str(body.summary, 300) || null,
        service: str(body.service, 80) || null,
        comment,
      })
      .select("id")
      .single();
    if (!error && data) return { ok: true, id: data.id, code, link, comment };
    if (!/duplicate|unique/i.test(error?.message ?? "")) throw new Error("Couldn't make the link just now.");
    code = makeCode();
  }
  throw new Error("Couldn't make the link just now.");
}

async function posted(profile: Profile, body: Json) {
  if (!isUuid(body.id)) return { ok: false, error: "Which comment?" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("outreach_links")
    .update({ posted_comment: str(body.text, 4000) || null, posted_comment_at: new Date().toISOString(), posted_at: new Date().toISOString() })
    .eq("id", body.id)
    .eq("profile_id", profile.id);
  if (error) throw new Error("Couldn't record that comment.");
  revalidatePath("/");
  return { ok: true };
}

async function skip(profile: Profile, body: Json) {
  if (!isUuid(body.id)) return { ok: true };
  const supabase = await createClient();
  // Only a link that never went out: anything posted stays on the record.
  await supabase.from("outreach_links").delete().eq("id", body.id).eq("profile_id", profile.id).is("posted_comment_at", null).eq("click_count", 0);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Posts: approve, then schedule                                               */
/* -------------------------------------------------------------------------- */

interface PostRow {
  id: string;
  status: string;
  caption: string | null;
  hook: string | null;
  body: string | null;
  cta: string | null;
  hashtags: string[] | string | null;
  image_path: string | null;
  before_photo_id: string | null;
  after_photo_id: string | null;
  zone_name: string | null;
  scheduled_for: string | null;
  results: Record<string, unknown> | null;
  created_at: string;
}

const POST_FIELDS = "id, status, caption, hook, body, cta, hashtags, image_path, before_photo_id, after_photo_id, zone_name, scheduled_for, results, created_at";

/** On Facebook already: Meta gave it an id. A row marked scheduled in the app alone is not. */
function onFacebook(row: Pick<PostRow, "results">): boolean {
  const fb = (row.results ?? {}).facebook as { id?: string; post_id?: string } | undefined;
  return Boolean(fb && (fb.id || fb.post_id));
}

function hasPicture(row: PostRow): boolean {
  return Boolean(row.image_path || (row.before_photo_id && row.after_photo_id));
}

function captionOf(row: PostRow): string {
  if (row.caption?.trim()) return row.caption.trim();
  const tags = Array.isArray(row.hashtags) ? row.hashtags.join(" ") : (row.hashtags ?? "");
  return [row.hook, row.body, row.cta, tags].map((p) => (p ?? "").trim()).filter(Boolean).join("\n\n");
}

async function postCounts(organizationId: string) {
  if (!isSupabaseAdminConfigured) return null;
  const { data } = await socialDb()
    .from("social_posts")
    .select(POST_FIELDS)
    .eq("organization_id", organizationId)
    .in("status", ["draft", "approved", "scheduled"])
    .limit(200);
  const rows = ((data ?? []) as PostRow[]).filter(hasPicture);
  return {
    toReview: rows.filter((r) => r.status === "draft" || (r.status === "scheduled" && !onFacebook(r))).length,
    approved: rows.filter((r) => r.status === "approved").length,
    scheduled: rows.filter((r) => r.status === "scheduled" && onFacebook(r)).length,
  };
}

async function picturesFor(row: PostRow, forFacebook: boolean): Promise<string[]> {
  const admin = createAdminClient();
  if (row.image_path) return [`${env.supabaseUrl}/storage/v1/object/public/social-posts/${row.image_path}`];
  const ids = [row.before_photo_id, row.after_photo_id].filter((v): v is string => Boolean(v));
  const { data } = await admin.from("job_photos").select("id, path").in("id", ids);
  const byId = new Map(((data ?? []) as { id: string; path: string }[]).map((p) => [p.id, p.path]));
  const urls: string[] = [];
  for (const id of ids) {
    const path = byId.get(id);
    if (!path) continue;
    // Facebook fetches the picture the moment it's handed the address, so an hour is plenty.
    const { data: signed } = await admin.storage.from("job-photos").createSignedUrl(path, forFacebook ? 60 * 60 : 60 * 30);
    if (signed?.signedUrl) urls.push(signed.signedUrl);
  }
  return urls;
}

async function review(organizationId: string) {
  const { data, error } = await socialDb()
    .from("social_posts")
    .select(POST_FIELDS)
    .eq("organization_id", organizationId)
    .in("status", ["draft", "scheduled"])
    .order("created_at", { ascending: true })
    .limit(60);
  if (error) throw new Error("Couldn't load the posts.");
  const rows = ((data ?? []) as PostRow[]).filter((r) => hasPicture(r) && !onFacebook(r)).slice(0, 12);
  const posts = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      caption: captionOf(r),
      where: r.zone_name,
      pictures: await picturesFor(r, false),
      // Approved in the old app, but nothing ever put it on Facebook.
      stale: r.status === "scheduled",
    }))
  );
  return { ok: true, posts };
}

async function decide(profile: Profile, body: Json) {
  if (!isUuid(body.id)) return { ok: false, error: "Which post?" };
  const admin = socialDb();
  const now = new Date().toISOString();
  if (body.decision === "deny") {
    const { error } = await admin
      .from("social_posts")
      .update({ status: "denied", denied_reason: str(body.reason, 300) || null, denied_by: profile.id, denied_at: now, updated_at: now })
      .eq("id", body.id)
      .eq("organization_id", profile.organization_id);
    if (error) throw new Error("Couldn't save that.");
    return { ok: true };
  }
  if (body.decision !== "approve") return { ok: false, error: "Approve or deny?" };
  // Both halves, as the owner asked: the before-and-after and the words.
  if (body.photoOk !== true || body.captionOk !== true) return { ok: false, error: "Tick both the photo and the caption first." };
  const caption = str(body.caption, 2200);
  if (!caption) return { ok: false, error: "The caption is empty." };
  if (/\bfree\b/i.test(caption)) return { ok: false, error: "The caption says \"free\". We don't promise free; change it first." };
  const { error } = await admin
    .from("social_posts")
    .update({ status: "approved", caption, approved_by: profile.id, approved_at: now, scheduled_for: null, updated_at: now })
    .eq("id", body.id)
    .eq("organization_id", profile.organization_id);
  if (error) throw new Error("Couldn't save that.");
  return { ok: true };
}

async function schedule(organizationId: string) {
  const admin = socialDb();
  const { data: approvedRows } = await admin
    .from("social_posts")
    .select(POST_FIELDS)
    .eq("organization_id", organizationId)
    .eq("status", "approved")
    .order("approved_at", { ascending: true })
    .limit(10);
  const approved = ((approvedRows ?? []) as PostRow[]).filter(hasPicture);
  if (approved.length === 0) return { ok: true, scheduled: [], waiting: 0, message: "No approved posts waiting." };

  const page = await postingPage(organizationId);
  if (!page) return { ok: true, scheduled: [], waiting: approved.length, needsMeta: true, message: "Connect the Facebook page so approved posts can be scheduled." };

  // Days already taken: anything on Facebook, scheduled there or already out.
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const { data: busy } = await admin
    .from("social_posts")
    .select("status, scheduled_for, posted_at, results")
    .eq("organization_id", organizationId)
    .in("status", ["scheduled", "posted"])
    .or(`scheduled_for.gte.${since},posted_at.gte.${since}`)
    .limit(200);
  const taken = new Set<string>();
  for (const row of (busy ?? []) as { status: string; scheduled_for: string | null; posted_at: string | null; results: Record<string, unknown> | null }[]) {
    const when = row.status === "posted" ? (row.posted_at ?? row.scheduled_for) : row.scheduled_for;
    if (when && (row.status === "posted" || onFacebook(row))) taken.add(dateKeyIn(new Date(when)));
  }
  const { data: cadence } = await admin.from("social_cadence").select("slots").eq("organization_id", organizationId).maybeSingle();
  const slots = readSlots(cadence?.slots);

  const scheduled: { id: string; when: string }[] = [];
  const problems: string[] = [];
  for (const row of approved) {
    const slot = nextOpenSlot({ now: new Date(), taken, slots });
    if (!slot) {
      problems.push("The next four weeks are full; the rest wait for an open day.");
      break;
    }
    try {
      const pictures = await picturesFor(row, true);
      if (pictures.length === 0) throw new GraphError("Its photos are missing.", 400, null);
      const fbId = await schedulePhotoPost({ pageId: page.pageId, pageToken: page.token, imageUrls: pictures, caption: captionOf(row), at: slot.at });
      const now = new Date().toISOString();
      await admin
        .from("social_posts")
        .update({
          status: "scheduled",
          scheduled_for: slot.at.toISOString(),
          platforms: ["facebook"],
          results: { ...(row.results ?? {}), facebook: { id: fbId, scheduled_for: slot.at.toISOString(), page: page.name } },
          last_error: null,
          last_attempt_at: now,
          updated_at: now,
        })
        .eq("id", row.id);
      taken.add(slot.dateKey);
      scheduled.push({ id: row.id, when: shortWhen(slot.at) });
    } catch (err) {
      const message = err instanceof GraphError ? `Facebook said: ${err.message}` : "Couldn't schedule it.";
      await admin.from("social_posts").update({ last_error: message, last_attempt_at: new Date().toISOString() }).eq("id", row.id);
      problems.push(message);
    }
  }
  return { ok: true, scheduled, waiting: approved.length - scheduled.length, problems, page: page.name };
}
