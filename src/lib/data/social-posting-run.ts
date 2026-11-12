import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { isMissingColumn } from "@/lib/setup-errors";
import { localDay } from "@/lib/marketing/social-autopost";
import { publishPhotoToInstagram, publishPhotoToPage, publishTargets, type PublishResult } from "@/lib/social/facebook";
import {
  afterFailure,
  BLOCKED_REASON,
  CLAIM_MINUTES,
  isStale,
  NOT_CONNECTED,
  reachable,
  stillToSend,
  tidyResults,
  type PublishFailure,
} from "@/lib/social/autopost";
import { fillSlots, type SocialPlatform } from "@/lib/social/cadence";
import { loadCadence } from "@/lib/data/social-autopost";

/**
 * The posting job for one business, in three steps:
 *
 * 1. Posts whose slot passed more than two days ago without a try go back to
 *    'approved' (re-slotted below) rather than all going out at once late.
 * 2. Approved posts with no time get the next free slot under the cadence.
 * 3. Posts whose time has come go to each of their accounts. An account that
 *    takes it is recorded, so a retry never posts twice; one that refuses is
 *    retried later (15 min, 1 h, 4 h) or, when retrying can't help (expired
 *    key, missing permission, bad picture), the post stops at 'failed' with
 *    Meta's reason. Nothing connected is not a failure of the post: it waits,
 *    with the reason on it.
 *
 * Runs with the service role. Safe to run twice at once: a post is claimed
 * before it is sent.
 */

const untyped = (c: unknown) => c as SupabaseClient;

export interface PostingRun {
  organizationId: string;
  reslotted: number;
  filled: number;
  due: number;
  sent: number;
  retrying: number;
  failed: number;
  waiting: number;
  reason?: string;
  error?: string;
}

interface DueRow {
  id: string;
  caption: string | null;
  image_path: string | null;
  plan_day: string | null;
  platforms: string[] | null;
  results: unknown;
  attempts: number | null;
}

function imageFor(post: DueRow, platform: SocialPlatform | "webhook", supabaseUrl: string, appBase: string): string | null {
  if (post.image_path) {
    // Instagram takes JPEG only; the studio saves PNG.
    return platform === "instagram" ? `${appBase}/api/social/post-image/${post.id}` : `${supabaseUrl}/storage/v1/object/public/social-posts/${post.image_path}`;
  }
  if (post.plan_day) return `${appBase}/api/social/card/${post.id}${platform === "instagram" ? "?format=jpg" : ""}`;
  return null;
}

export async function runSocialPosting(client: unknown, organizationId: string, appBase: string, now = new Date()): Promise<PostingRun> {
  const sb = untyped(client);
  const run: PostingRun = { organizationId, reslotted: 0, filled: 0, due: 0, sent: 0, retrying: 0, failed: 0, waiting: 0 };
  const nowIso = () => new Date().toISOString();
  const cadenceRow = await loadCadence(sb, organizationId);
  if (!cadenceRow.ready) {
    run.error = "Migration 0374_social_autopost.sql is not applied.";
    return run;
  }
  const cadence = cadenceRow.cadence;

  // 1. Missed slots back to approved, for a new time.
  const { data: scheduledRows, error: schedErr } = await sb
    .from("social_posts")
    .select("id, scheduled_for, attempts")
    .eq("organization_id", organizationId)
    .eq("placement", "page")
    .eq("status", "scheduled")
    .lt("scheduled_for", now.toISOString())
    .limit(200);
  if (schedErr) {
    run.error = isMissingColumn(schedErr) ? "Migration 0374_social_autopost.sql is not applied." : schedErr.message;
    return run;
  }
  for (const r of (scheduledRows ?? []) as { id: string; scheduled_for: string | null; attempts: number | null }[]) {
    if (!isStale({ scheduledFor: r.scheduled_for, attempts: r.attempts ?? 0 }, now)) continue;
    const { error } = await sb
      .from("social_posts")
      .update({ status: "approved", scheduled_for: null, last_error: "Missed its slot without being sent; given a new one.", updated_at: nowIso() })
      .eq("id", r.id)
      .eq("status", "scheduled")
      .eq("attempts", 0);
    if (!error) run.reslotted++;
  }

  // 2. Approved posts into slots.
  if (cadence.autofill) {
    const [{ data: waiting }, { data: booked }] = await Promise.all([
      sb
        .from("social_posts")
        .select("id, platforms, plan_day")
        .eq("organization_id", organizationId)
        .eq("placement", "page")
        .eq("status", "approved")
        .is("scheduled_for", null)
        .order("approved_at", { ascending: true, nullsFirst: false })
        .limit(50),
      sb
        .from("social_posts")
        .select("scheduled_for, platforms")
        .eq("organization_id", organizationId)
        .eq("placement", "page")
        .in("status", ["scheduled", "posted"])
        .gte("scheduled_for", new Date(now.getTime() - 7 * 86_400_000).toISOString())
        .limit(500),
    ]);
    const waitingRows = (waiting ?? []) as { id: string; platforms: string[] | null; plan_day: string | null }[];
    const planned = new Set(waitingRows.filter((w) => w.plan_day).map((w) => w.id));
    const assignments = fillSlots({
      cadence,
      waiting: waitingRows.map((w) => ({ id: w.id, platforms: w.platforms ?? ["facebook", "instagram"] })),
      booked: ((booked ?? []) as { scheduled_for: string; platforms: string[] | null }[]).map((b) => ({ at: b.scheduled_for, platforms: b.platforms ?? ["facebook"] })),
      now,
    });
    for (const a of assignments) {
      const { error } = await sb
        .from("social_posts")
        .update({
          status: "scheduled",
          scheduled_for: a.scheduledFor,
          // A planned post's day moves with it, so its picture's "this week" stays true.
          ...(planned.has(a.id) ? { plan_day: localDay(a.scheduledFor) } : {}),
          next_attempt_at: null,
          last_error: null,
          updated_at: nowIso(),
        })
        .eq("id", a.id)
        .eq("status", "approved");
      if (!error) run.filled++;
    }
  }

  // 3. Due posts out.
  const { data: dueRows } = await sb
    .from("social_posts")
    .select("id, caption, image_path, plan_day, platforms, results, attempts")
    .eq("organization_id", organizationId)
    .eq("placement", "page")
    .eq("status", "scheduled")
    .lte("scheduled_for", now.toISOString())
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now.toISOString()}`)
    .order("scheduled_for", { ascending: true })
    .limit(10);
  const due = (dueRows ?? []) as DueRow[];
  run.due = due.length;
  if (!due.length) return run;

  const targets = await publishTargets(organizationId);
  const webhook = env.socialWebhookUrl;
  const connection = { ...targets, webhook: Boolean(webhook) };
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const staleClaim = new Date(now.getTime() - CLAIM_MINUTES * 60_000).toISOString();

  for (const post of due) {
    const platforms = post.platforms?.length ? post.platforms : ["facebook"];
    const results = tidyResults(post.results) as Record<string, { id: string; at: string }>;
    const rawResults = (post.results && typeof post.results === "object" ? { ...(post.results as Record<string, unknown>) } : {}) as Record<string, unknown>;
    const todo = stillToSend(platforms, results);
    const { send, blocked } = reachable(todo, connection);
    const handoff = Boolean(webhook) && !rawResults.webhook;

    if (send.length === 0 && !handoff) {
      // Nowhere to send it: it waits with the reason, and no try is counted.
      const reason = blocked.includes("facebook") ? NOT_CONNECTED.reason : BLOCKED_REASON[blocked[0] ?? "facebook"];
      await sb.from("social_posts").update({ last_error: reason, updated_at: nowIso() }).eq("id", post.id).eq("status", "scheduled");
      run.waiting++;
      run.reason = reason;
      continue;
    }

    // Claimed before it goes anywhere, so two runs at once cannot both post it.
    const { data: claimed } = await sb
      .from("social_posts")
      .update({ channel: "posting", updated_at: nowIso() })
      .eq("id", post.id)
      .eq("status", "scheduled")
      .or(`channel.is.null,channel.neq.posting,updated_at.lt.${staleClaim}`)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    const failures: PublishFailure[] = [];
    for (const platform of send) {
      const imageUrl = imageFor(post, platform, supabaseUrl, appBase);
      if (!imageUrl) {
        failures.push({ kind: "media", retry: false, reason: "The post has no picture." });
        continue;
      }
      const input = { organizationId, imageUrl, caption: post.caption ?? "" };
      const sent: PublishResult = platform === "facebook" ? await publishPhotoToPage(input) : await publishPhotoToInstagram(input);
      if (sent.ok) {
        results[platform] = { id: sent.postId, at: nowIso() };
        rawResults[platform] = results[platform];
      } else failures.push(sent.failure);
    }

    if (handoff) {
      const imageUrl = imageFor(post, "webhook", supabaseUrl, appBase);
      try {
        const response = await fetch(webhook, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: post.id, imageUrl, caption: post.caption ?? "" }),
        });
        if (response.ok) rawResults.webhook = { id: "handoff", at: nowIso() };
        else failures.push({ kind: "transient", retry: true, reason: `The posting hand-off answered ${response.status}.` });
      } catch (err) {
        log.error("social_post.handoff.failed", err, { postId: post.id });
        failures.push({ kind: "transient", retry: true, reason: "The posting hand-off couldn't be reached." });
      }
    }

    const channels = [...Object.keys(results), ...(rawResults.webhook ? ["webhook"] : [])];
    const anySent = channels.length > 0;
    const remaining = stillToSend(platforms, results).filter((p) => !blocked.includes(p));
    const retryable = failures.filter((f) => f.retry);
    const notes = [...failures.map((f) => f.reason), ...blocked.map((p) => `Skipped ${p}: ${BLOCKED_REASON[p]}`)];

    // Done: every reachable account has it, or what is left can't be helped by trying again.
    if (anySent && (remaining.length === 0 || retryable.length === 0)) {
      await sb
        .from("social_posts")
        .update({
          status: "posted",
          posted_at: nowIso(),
          channel: channels.join("+"),
          results: rawResults,
          last_error: notes.length ? notes.join(" ") : null,
          next_attempt_at: null,
          updated_at: nowIso(),
        })
        .eq("id", post.id);
      log.info("social_post.published", { postId: post.id, channels });
      run.sent++;
      continue;
    }

    // Not done: retry later, or stop with the reason.
    const worst = failures.find((f) => !f.retry) ?? failures[0] ?? NOT_CONNECTED;
    const next = afterFailure(post.attempts ?? 0, worst, now);
    await sb
      .from("social_posts")
      .update({
        status: next.status,
        attempts: next.attempts,
        next_attempt_at: next.nextAttemptAt,
        last_attempt_at: nowIso(),
        last_error: notes.join(" ") || worst.reason,
        results: rawResults,
        channel: anySent ? channels.join("+") : null,
        updated_at: nowIso(),
      })
      .eq("id", post.id);
    log.warn("social_post.unpublished", { postId: post.id, status: next.status, attempts: next.attempts, kind: worst.kind });
    if (next.status === "failed") run.failed++;
    else run.retrying++;
    run.reason = worst.reason;
  }
  return run;
}

/** The run, kept on the cadence row for the status line. */
export async function recordRun(client: unknown, run: PostingRun): Promise<void> {
  if (run.error?.includes("0374")) return;
  const now = new Date().toISOString();
  const sb = untyped(client);
  const { data: existing } = await sb.from("social_cadence").select("organization_id").eq("organization_id", run.organizationId).maybeSingle();
  const patch = { last_run_at: now, last_run: run, ...(run.sent > 0 ? { last_success_at: now } : {}), updated_at: now };
  if (existing) await sb.from("social_cadence").update(patch).eq("organization_id", run.organizationId);
  else await sb.from("social_cadence").insert({ organization_id: run.organizationId, ...patch });
}
