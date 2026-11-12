/**
 * The rules of the posting job: which failures are worth trying again, how
 * long to wait, when a post is too old to send, and the one line the owner
 * reads to know whether posting works.
 *
 * Pure, so the rules are tested and the job only does what they say.
 */

import { PLATFORM_LABEL, SOCIAL_PLATFORMS, type SocialPlatform } from "@/lib/social/cadence";

/** Tries before a post stops at 'failed'. */
export const MAX_ATTEMPTS = 4;

/** Minutes to wait after the 1st, 2nd and 3rd failed try. */
export const RETRY_MINUTES = [15, 60, 240] as const;

/**
 * A post whose time passed this long ago without a single try is not sent
 * late (a "this week" post going out a month on is wrong, and a backlog
 * would all go out in one run); it goes back to 'approved' and the
 * scheduler gives it a new slot.
 */
export const STALE_HOURS = 48;

/** A claim older than this belongs to a run that died, and can be taken over. */
export const CLAIM_MINUTES = 15;

export type FailureKind = "auth" | "permission" | "not_connected" | "media" | "transient";

export interface PublishFailure {
  kind: FailureKind;
  /** Whether trying again later can help. */
  retry: boolean;
  /** What the owner reads. */
  reason: string;
}

/**
 * What a refusal from Meta means. Graph error codes:
 * 190 (and 102, 463, 467) the key is expired or revoked; 10 and 200-299 a
 * permission is missing; 100 / 324 / 352 / 9004 / 36000-36003 / 2207xxx the
 * picture can't be used; 1, 2, 4, 17, 32, 341, 368, 613 and any 5xx are
 * Meta being busy or limiting, which passes.
 */
export function classifyPublishError(input: { code?: number | null; status?: number | null; message?: string | null; platform?: SocialPlatform }): PublishFailure {
  const code = input.code ?? null;
  const status = input.status ?? null;
  const message = (input.message ?? "").trim() || "Meta refused it.";
  const where = input.platform ? PLATFORM_LABEL[input.platform] : "Meta";

  if (code === 190 || code === 102 || code === 463 || code === 467 || /access token|session has expired|session is invalid/i.test(message)) {
    return { kind: "auth", retry: false, reason: `${where}: the connection's key has expired or was revoked. Reconnect in Admin › Facebook & Instagram. (${message})` };
  }
  if (code === 10 || (code !== null && code >= 200 && code <= 299) || /permission|not authorized|hasn't authorized/i.test(message)) {
    return { kind: "permission", retry: false, reason: `${where}: a permission is missing. Reconnect and allow every permission. (${message})` };
  }
  if (code === 324 || code === 352 || code === 9004 || (code !== null && code >= 36000 && code <= 36003) || (code !== null && code >= 2207000 && code <= 2207999) || /image|media|aspect ratio|format/i.test(message)) {
    return { kind: "media", retry: false, reason: `${where} couldn't use the picture. (${message})` };
  }
  return { kind: "transient", retry: true, reason: `${where}: ${message}${status ? ` (HTTP ${status})` : ""}` };
}

/** Nothing to send to: not a failure of the post, so no try is counted. */
export const NOT_CONNECTED: PublishFailure = {
  kind: "not_connected",
  retry: true,
  reason: "No Facebook page is connected for posting. Admin › Facebook & Instagram: save the Meta app, press Connect Facebook, and tick Posting on the page.",
};

/** After a try that did not finish: tried again later, or stopped with its reason. */
export function afterFailure(attemptsBefore: number, failure: PublishFailure, now: Date): { status: "scheduled" | "failed"; attempts: number; nextAttemptAt: string | null } {
  const attempts = attemptsBefore + 1;
  if (!failure.retry || attempts >= MAX_ATTEMPTS) return { status: "failed", attempts, nextAttemptAt: null };
  const wait = RETRY_MINUTES[Math.min(attempts - 1, RETRY_MINUTES.length - 1)];
  return { status: "scheduled", attempts, nextAttemptAt: new Date(now.getTime() + wait * 60_000).toISOString() };
}

/** Whether a scheduled post should be re-slotted instead of sent. */
export function isStale(post: { scheduledFor: string | null; attempts: number }, now: Date): boolean {
  if (!post.scheduledFor || post.attempts > 0) return false;
  return now.getTime() - Date.parse(post.scheduledFor) > STALE_HOURS * 3_600_000;
}

export type PlatformResults = Partial<Record<SocialPlatform, { id: string; at: string }>>;

/** Results as stored, cleaned. */
export function tidyResults(raw: unknown): PlatformResults {
  const out: PlatformResults = {};
  if (!raw || typeof raw !== "object") return out;
  for (const p of SOCIAL_PLATFORMS) {
    const r = (raw as Record<string, unknown>)[p] as { id?: unknown; at?: unknown } | undefined;
    if (r && typeof r.id === "string" && typeof r.at === "string") out[p] = { id: r.id, at: r.at };
  }
  return out;
}

/** The accounts a post still has to reach: those it is for, minus those that have it. */
export function stillToSend(platforms: readonly string[], results: PlatformResults): SocialPlatform[] {
  return SOCIAL_PLATFORMS.filter((p) => platforms.includes(p) && !results[p]);
}

export interface Connection {
  facebook: boolean;
  instagram: boolean;
  /** SOCIAL_WEBHOOK_URL hand-off (Zapier, Make, Buffer). */
  webhook: boolean;
}

/**
 * Which of a post's accounts can be sent to now. A post for Instagram on a
 * page with no Instagram linked is sent to Facebook, and Instagram is
 * reported as the reason it is not finished.
 */
export function reachable(todo: readonly SocialPlatform[], c: Connection): { send: SocialPlatform[]; blocked: SocialPlatform[] } {
  const send = todo.filter((p) => c[p]);
  return { send, blocked: todo.filter((p) => !c[p]) };
}

export const BLOCKED_REASON: Record<SocialPlatform, string> = {
  facebook: NOT_CONNECTED.reason,
  instagram:
    "Instagram isn't linked to the posting page. Link the Instagram professional account to the Facebook page (Meta Business Suite › Settings › Linked accounts), then Admin › Facebook & Instagram › Connect again and allow instagram_content_publish.",
};

export interface HealthInput {
  migrationApplied: boolean;
  connection: Connection;
  lastPostedAt: string | null;
  lastPostedChannel: string | null;
  nextAt: string | null;
  scheduledCount: number;
  approvedWaiting: number;
  drafts: number;
  failed: { error: string | null; at: string | null }[];
  retrying: { error: string | null; nextAttemptAt: string | null }[];
  overdue: number;
  lastRunAt: string | null;
  now: Date;
}

export interface Health {
  tone: "good" | "warn" | "bad";
  headline: string;
  /** The reason it is failing, in words, or null when it isn't. */
  failingBecause: string | null;
  lines: string[];
}

/** The status line: last posted, next post, and what is wrong if anything is. */
export function describeHealth(h: HealthInput, when: (iso: string) => string): Health {
  const lines: string[] = [];
  lines.push(h.lastPostedAt ? `Last posted ${when(h.lastPostedAt)}${h.lastPostedChannel ? ` (${h.lastPostedChannel})` : ""}.` : "Nothing has been posted from the app yet.");
  lines.push(h.nextAt ? `Next post ${when(h.nextAt)}; ${h.scheduledCount} scheduled.` : "Nothing is scheduled.");
  if (h.approvedWaiting) lines.push(`${h.approvedWaiting} approved, waiting for a slot.`);
  if (h.drafts) lines.push(`${h.drafts} draft${h.drafts === 1 ? "" : "s"} waiting for approval.`);
  lines.push(h.lastRunAt ? `The posting job last ran ${when(h.lastRunAt)}.` : "The posting job hasn't reported a run yet.");

  let failingBecause: string | null = null;
  if (!h.migrationApplied) failingBecause = "The database is missing migration 0374_social_autopost.sql, so the posting job can't record tries or failures.";
  else if (!h.connection.facebook && !h.connection.webhook) failingBecause = NOT_CONNECTED.reason;
  else if (h.failed.length) failingBecause = h.failed[0].error ?? "A post failed.";
  else if (h.retrying.length) failingBecause = h.retrying[0].error ?? "A post is being retried.";
  else if (h.overdue > 0) failingBecause = `${h.overdue} post${h.overdue === 1 ? " is" : "s are"} past due and not sent.`;

  if (!h.connection.instagram && h.connection.facebook) lines.push(BLOCKED_REASON.instagram);

  if (failingBecause) {
    const hard = !h.migrationApplied || (!h.connection.facebook && !h.connection.webhook) || h.failed.length > 0;
    return { tone: hard ? "bad" : "warn", headline: `Posting is failing: ${failingBecause}`, failingBecause, lines };
  }
  if (!h.nextAt) return { tone: "warn", headline: "Posting works, but nothing is scheduled. Approve some drafts.", failingBecause: null, lines };
  return { tone: "good", headline: `Posting works. Next post ${when(h.nextAt)}.`, failingBecause: null, lines };
}
