import type { SupabaseClient } from "@supabase/supabase-js";

import { outboundBaseUrl } from "@/lib/base-url";
import { draftReviewReply } from "@/lib/data/review-reply-writer";
import { createPhotoPost, fetchInsights, findLocation, listReviews, replyToReview, type BusinessLocation } from "@/lib/google/business";
import { googleAccessToken } from "@/lib/google/oauth";
import { getIntegration, saveIntegration } from "@/lib/integrations/store";
import { log } from "@/lib/log";
import { mayActOn, type AutopilotSettings, type StartedMap } from "@/lib/marketing/autopilot-settings";
import { belongsOnBookingPage, firstName, replyPolicy, shouldDraft } from "@/lib/marketing/review-replies";

/**
 * One daily pass of Google Business Profile for one business:
 *
 * - pull the reviews and keep each once (google_reviews), putting the good
 *   ones with words on the booking page (booking_proof), so nobody types a
 *   review in by hand again;
 * - draft a reply to each new one, post 4-5 stars, hold 1-3 for a person;
 * - read calls, direction requests and website clicks;
 * - once a week, post an approved before-and-after to the listing.
 *
 * Runs with the service role. Without a connection it says so and does
 * nothing else.
 */

const untyped = (c: unknown) => c as SupabaseClient;

export const GBP = "google_business";

export interface GbpRunResult {
  connected: boolean;
  error?: string;
  pulled: number;
  added: number;
  toBookingPage: number;
  drafted: number;
  posted: number;
  held: number;
  insightDays: number;
  weeklyPost: "posted" | "not_due" | "nothing_to_post" | "off" | "failed";
}

const empty = (connected: boolean, error?: string): GbpRunResult => ({
  connected,
  error,
  pulled: 0,
  added: 0,
  toBookingPage: 0,
  drafted: 0,
  posted: 0,
  held: 0,
  insightDays: 0,
  weeklyPost: "off",
});

/** The location to use, discovered once and remembered in the integration's settings. */
export async function gbpLocation(org: string, token: string, secrets: Record<string, string>): Promise<{ ok: true; loc: BusinessLocation } | { ok: false; error: string }> {
  const row = await getIntegration(org, GBP);
  const s = (row?.settings ?? {}) as { account?: string; location?: string; location_title?: string };
  if (s.account && s.location) return { ok: true, loc: { account: s.account, location: s.location, title: s.location_title ?? "" } };
  const found = await findLocation(token, secrets.location_id || null);
  if (!found.ok) return found;
  await saveIntegration(org, GBP, { settings: { account: found.value.account, location: found.value.location, location_title: found.value.title } });
  return { ok: true, loc: found.value };
}

export async function runGoogleBusiness(
  client: unknown,
  org: string,
  autopilot: { settings: AutopilotSettings; started: StartedMap },
  now = new Date()
): Promise<GbpRunResult> {
  const sb = untyped(client);
  const row = await getIntegration(org, GBP);
  if (!row || row.status === "not_connected") return empty(false, "Not connected — add it in Settings › Integrations.");
  const auth = await googleAccessToken(row.secrets);
  if (!auth.ok) {
    await saveIntegration(org, GBP, { status: "error", lastError: auth.error });
    return empty(false, auth.error);
  }
  const located = await gbpLocation(org, auth.token, row.secrets);
  if (!located.ok) {
    await saveIntegration(org, GBP, { status: "error", lastError: located.error });
    return empty(false, located.error);
  }
  const loc = located.loc;
  const result = empty(true);

  const { data: orgRow } = await sb.from("organizations").select("name").eq("id", org).maybeSingle();
  const businessName = (orgRow as { name?: string } | null)?.name ?? "JS Landscaping";

  // 1. Reviews in.
  const pulled = await listReviews(auth.token, loc);
  if (!pulled.ok) {
    await saveIntegration(org, GBP, { status: "error", lastError: pulled.error });
    return { ...result, error: pulled.error };
  }
  result.pulled = pulled.value.length;
  const names = pulled.value.map((r) => r.name);
  const { data: knownRows } = names.length
    ? await sb.from("google_reviews").select("review_name, reply_status, booking_proof_id").eq("organization_id", org).in("review_name", names)
    : { data: [] };
  const known = new Map(((knownRows ?? []) as { review_name: string; reply_status: string; booking_proof_id: string | null }[]).map((r) => [r.review_name, r]));

  for (const r of pulled.value) {
    const stamp = now.toISOString();
    const content = {
      author: r.author,
      stars: r.stars,
      body: r.body,
      reviewed_at: r.createdAt,
      remote_updated_at: r.updatedAt,
      updated_at: stamp,
    };
    const was = known.get(r.name);
    if (!was) {
      await sb.from("google_reviews").insert({
        organization_id: org,
        review_name: r.name,
        ...content,
        reply_status: r.reply ? "existing" : "none",
        reply_body: r.reply,
      });
      result.added++;
    } else {
      // A reply made on Google itself counts as answered.
      await sb
        .from("google_reviews")
        .update({ ...content, ...(r.reply && was.reply_status === "none" ? { reply_status: "existing", reply_body: r.reply } : {}) })
        .eq("organization_id", org)
        .eq("review_name", r.name);
    }
  }

  // 2. The good ones onto the booking page, once each, never one the owner deleted.
  const forPage = pulled.value.filter((r) => belongsOnBookingPage(r) && !known.get(r.name)?.booking_proof_id);
  if (forPage.length > 0) {
    const keys = forPage.map((r) => `gbp:${r.name}`);
    const [{ data: have }, { data: dismissed }, { data: typed }] = await Promise.all([
      sb.from("booking_proof").select("id, external_key").eq("organization_id", org).in("external_key", keys),
      sb.from("booking_proof_dismissed").select("external_key").eq("organization_id", org).in("external_key", keys),
      // A review the owner already typed in word for word is not added twice.
      sb.from("booking_proof").select("body").eq("organization_id", org).eq("kind", "review").limit(500),
    ]);
    const skip = new Set([...((have ?? []) as { external_key: string }[]).map((h) => h.external_key), ...((dismissed ?? []) as { external_key: string }[]).map((d) => d.external_key)]);
    const typedBodies = new Set(((typed ?? []) as { body: string | null }[]).map((t) => (t.body ?? "").trim().toLowerCase().slice(0, 120)));
    for (const r of forPage) {
      const key = `gbp:${r.name}`;
      if (skip.has(key) || typedBodies.has((r.body ?? "").trim().toLowerCase().slice(0, 120))) continue;
      const first = firstName(r.author);
      const lastInitial = (r.author ?? "").trim().split(/\s+/)[1]?.[0];
      const { data: inserted } = await sb
        .from("booking_proof")
        .insert({
          organization_id: org,
          kind: "review",
          author: first ? `${first}${lastInitial ? ` ${lastInitial}.` : ""}` : "Google reviewer",
          body: (r.body ?? "").slice(0, 1500),
          stars: r.stars,
          source: "Google",
          written_on: r.createdAt ? r.createdAt.slice(0, 10) : null,
          external_key: key,
          shown: true,
          position: 0,
        })
        .select("id")
        .maybeSingle();
      if (inserted) {
        await sb.from("google_reviews").update({ booking_proof_id: (inserted as { id: string }).id }).eq("organization_id", org).eq("review_name", r.name);
        result.toBookingPage++;
      }
    }
  }

  // 3. Replies: only to reviews written or changed after replies were switched on.
  if (autopilot.settings.enabled.review_replies) {
    const { data: waiting } = await sb
      .from("google_reviews")
      .select("id, review_name, author, stars, body, reviewed_at, remote_updated_at")
      .eq("organization_id", org)
      .eq("reply_status", "none")
      .order("reviewed_at", { ascending: false })
      .limit(20);
    for (const w of (waiting ?? []) as { id: string; review_name: string; author: string | null; stars: number | null; body: string | null; reviewed_at: string | null; remote_updated_at: string | null }[]) {
      if (!shouldDraft({ reviewedAt: w.reviewed_at, updatedAt: w.remote_updated_at, hasReply: false, startedAt: autopilot.started.review_replies ?? null })) continue;
      const draft = await draftReviewReply(w, businessName);
      result.drafted++;
      if (replyPolicy(w.stars) === "auto") {
        const posted = await replyToReview(auth.token, w.review_name, draft.reply);
        await sb
          .from("google_reviews")
          .update(
            posted.ok
              ? { reply_status: "posted", reply_draft: draft.reply, reply_body: draft.reply, reply_posted_at: now.toISOString(), reply_error: null, updated_at: now.toISOString() }
              : { reply_status: "failed", reply_draft: draft.reply, reply_error: posted.error, updated_at: now.toISOString() }
          )
          .eq("id", w.id);
        if (posted.ok) result.posted++;
      } else {
        await sb.from("google_reviews").update({ reply_status: "held", reply_draft: draft.reply, updated_at: now.toISOString() }).eq("id", w.id);
        result.held++;
      }
    }
  }

  // 4. Insights for the last 30 days (Google reports with a lag of a few days).
  const end = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 31 * 86_400_000).toISOString().slice(0, 10);
  const insights = await fetchInsights(auth.token, loc, start, end);
  if (insights.ok && insights.value.length > 0) {
    await sb.from("google_business_insights").upsert(
      insights.value.map((d) => ({
        organization_id: org,
        day: d.day,
        calls: d.calls,
        directions: d.directions,
        website_clicks: d.websiteClicks,
        updated_at: now.toISOString(),
      }))
    );
    result.insightDays = insights.value.length;
  } else if (!insights.ok) {
    log.warn("gbp.insights_failed", { org, error: insights.error });
  }

  // 5. The weekly post.
  result.weeklyPost = await weeklyPost(sb, org, auth.token, loc, autopilot, now);

  await saveIntegration(org, GBP, { status: "connected", lastError: null });
  return result;
}

/** One approved before-and-after a week, never the same one twice. */
async function weeklyPost(
  sb: SupabaseClient,
  org: string,
  token: string,
  loc: BusinessLocation,
  autopilot: { settings: AutopilotSettings; started: StartedMap },
  now: Date
): Promise<GbpRunResult["weeklyPost"]> {
  if (!autopilot.settings.enabled.gbp_weekly_post) return "off";
  const { data: last } = await sb
    .from("google_business_posts")
    .select("posted_at")
    .eq("organization_id", org)
    .eq("status", "posted")
    .order("posted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastAt = (last as { posted_at?: string } | null)?.posted_at;
  if (lastAt && now.getTime() - Date.parse(lastAt) < 6.5 * 86_400_000) return "not_due";

  const { data: done } = await sb.from("google_business_posts").select("social_post_id").eq("organization_id", org).not("social_post_id", "is", null);
  const used = new Set(((done ?? []) as { social_post_id: string }[]).map((d) => d.social_post_id));
  const { data: candidates } = await sb
    .from("social_posts")
    .select("id, caption, body, image_path, plan_day, approved_at, before_photo_id, after_photo_id, status")
    .eq("organization_id", org)
    .in("status", ["scheduled", "posted"])
    .not("after_photo_id", "is", null)
    .order("approved_at", { ascending: false })
    .limit(30);
  const pick = ((candidates ?? []) as { id: string; caption: string | null; body: string | null; image_path: string | null; plan_day: string | null; approved_at: string | null }[]).find(
    (c) => !used.has(c.id) && mayActOn("gbp_weekly_post", autopilot.settings, autopilot.started, c.approved_at) && (c.image_path || c.plan_day)
  );
  if (!pick) return "nothing_to_post";

  const base = (await outboundBaseUrl()).replace(/\/$/, "");
  const imageUrl = pick.image_path
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/storage/v1/object/public/social-posts/${pick.image_path}`
    : `${base}/api/social/card/${pick.id}`;
  // Google posts carry no hashtags or links in the text; the button does the linking.
  const summary = (pick.caption ?? pick.body ?? "Another yard finished in Harford County.")
    .replace(/#\w+/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const posted = await createPhotoPost(token, loc, { summary, imageUrl, bookUrl: `${base}/book?utm_source=google&utm_medium=gbp_post` });
  await sb.from("google_business_posts").upsert(
    {
      organization_id: org,
      social_post_id: pick.id,
      remote_name: posted.ok ? posted.value : null,
      summary,
      image_url: imageUrl,
      status: posted.ok ? "posted" : "failed",
      error: posted.ok ? null : posted.error,
      posted_at: posted.ok ? now.toISOString() : null,
    },
    { onConflict: "organization_id,social_post_id" }
  );
  return posted.ok ? "posted" : "failed";
}

/** Posts one held reply after a person approved (and maybe edited) it. */
export async function postHeldReply(client: unknown, org: string, reviewId: string, reply: string, by: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = untyped(client);
  const { data: review } = await sb.from("google_reviews").select("id, review_name").eq("organization_id", org).eq("id", reviewId).maybeSingle();
  if (!review) return { ok: false, error: "No such review." };
  const row = await getIntegration(org, GBP);
  const auth = await googleAccessToken(row && row.status !== "not_connected" ? row.secrets : null);
  if (!auth.ok) return { ok: false, error: auth.error };
  const posted = await replyToReview(auth.token, (review as { review_name: string }).review_name, reply);
  const now = new Date().toISOString();
  await sb
    .from("google_reviews")
    .update(
      posted.ok
        ? { reply_status: "posted", reply_body: reply, reply_posted_at: now, reply_error: null, decided_by: by, decided_at: now, updated_at: now }
        : { reply_error: posted.error, updated_at: now }
    )
    .eq("id", reviewId);
  return posted.ok ? { ok: true } : { ok: false, error: posted.error };
}
