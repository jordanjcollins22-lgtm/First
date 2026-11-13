import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import { isMissingColumn, isMissingTable } from "@/lib/setup-errors";
import { describeHealth, type Connection, type Health, type HealthInput } from "@/lib/social/autopost";
import { tidyCadence, type SocialCadence } from "@/lib/social/cadence";
import { shortWhen } from "@/lib/time-zone";
import type { DataScope } from "@/lib/data/review-scope";

/**
 * The posting cadence and the posting job's health, read for one business.
 * Takes a DataScope so the admin page (the signed-in session) and the
 * preview review page (service role, read only) read the same way.
 */

const untyped = (c: unknown) => c as SupabaseClient;

export interface CadenceRow {
  cadence: SocialCadence;
  /** Whether migration 0374 is in: without it, the defaults are shown and nothing can be saved. */
  ready: boolean;
  lastRunAt: string | null;
  lastRun: Record<string, unknown> | null;
  lastSuccessAt: string | null;
}

export async function loadCadence(client: unknown, organizationId: string): Promise<CadenceRow> {
  const { data, error } = await untyped(client)
    .from("social_cadence")
    .select("facebook_per_week, instagram_per_week, slots, autofill, last_run_at, last_run, last_success_at")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) return { cadence: tidyCadence(null), ready: !(isMissingTable(error) || isMissingColumn(error)), lastRunAt: null, lastRun: null, lastSuccessAt: null };
  const row = data as { last_run_at?: string | null; last_run?: Record<string, unknown> | null; last_success_at?: string | null } | null;
  return {
    cadence: tidyCadence(data as Parameters<typeof tidyCadence>[0]),
    ready: true,
    lastRunAt: row?.last_run_at ?? null,
    lastRun: row?.last_run ?? null,
    lastSuccessAt: row?.last_success_at ?? null,
  };
}

export interface UpcomingPost {
  id: string;
  status: string;
  scheduledFor: string | null;
  platforms: string[];
  hook: string;
  lastError: string | null;
  attempts: number;
  /** The accounts it has gone out on so far, when known: shown as a tick or a cross on each. */
  sent?: string[];
}

export interface PostingStatus {
  health: Health;
  input: HealthInput;
  cadence: CadenceRow;
  upcoming: UpcomingPost[];
}

/** What the status line needs: connection, last post, next post, and anything failing. */
export async function loadPostingStatus(scope: DataScope, connection: Omit<Connection, "webhook">, now = new Date()): Promise<PostingStatus> {
  const sb = untyped(scope.client);
  const org = scope.organizationId;
  const cadence = await loadCadence(sb, org);

  const [last, upcomingRes, counts] = await Promise.all([
    sb.from("social_posts").select("posted_at, channel").eq("organization_id", org).eq("status", "posted").not("posted_at", "is", null).order("posted_at", { ascending: false }).limit(1).maybeSingle(),
    sb
      .from("social_posts")
      .select("id, status, scheduled_for, platforms, hook, caption, last_error, attempts, next_attempt_at, updated_at")
      .eq("organization_id", org)
      .eq("placement", "page")
      .in("status", ["scheduled", "approved", "failed"])
      .order("scheduled_for", { ascending: true, nullsFirst: false })
      .limit(60),
    sb.from("social_posts").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("status", "draft"),
  ]);

  let migrationApplied = cadence.ready;
  type Row = { id: string; status: string; scheduled_for: string | null; platforms?: string[] | null; hook: string | null; caption: string | null; last_error?: string | null; attempts?: number | null; next_attempt_at?: string | null; updated_at: string };
  let rows: Row[] = (upcomingRes.data ?? []) as Row[];
  if (upcomingRes.error && isMissingColumn(upcomingRes.error)) {
    migrationApplied = false;
    const legacy = await sb
      .from("social_posts")
      .select("id, status, scheduled_for, hook, caption, updated_at")
      .eq("organization_id", org)
      .eq("placement", "page")
      .in("status", ["scheduled", "approved"])
      .order("scheduled_for", { ascending: true, nullsFirst: false })
      .limit(60);
    rows = (legacy.data ?? []) as Row[];
  }

  const t = now.getTime();
  const scheduled = rows.filter((r) => r.status === "scheduled" && r.scheduled_for);
  const future = scheduled.filter((r) => Date.parse(r.scheduled_for as string) >= t);
  const overdue = scheduled.filter((r) => Date.parse(r.scheduled_for as string) < t - 2 * 3_600_000 && !(r.attempts ?? 0));
  const retrying = scheduled.filter((r) => (r.attempts ?? 0) > 0);
  const failed = rows.filter((r) => r.status === "failed").sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const lastRow = last.data as { posted_at: string; channel: string | null } | null;
  const input: HealthInput = {
    migrationApplied,
    connection: { ...connection, webhook: Boolean(env.socialWebhookUrl) },
    lastPostedAt: lastRow?.posted_at ?? null,
    lastPostedChannel: lastRow?.channel ?? null,
    nextAt: future[0]?.scheduled_for ?? null,
    scheduledCount: future.length,
    approvedWaiting: rows.filter((r) => r.status === "approved").length,
    drafts: counts.count ?? 0,
    failed: failed.map((r) => ({ error: r.last_error ?? null, at: r.updated_at })),
    retrying: retrying.map((r) => ({ error: r.last_error ?? null, nextAttemptAt: r.next_attempt_at ?? null })),
    overdue: overdue.length,
    lastRunAt: cadence.lastRunAt,
    now,
  };

  return {
    health: describeHealth(input, (iso) => shortWhen(iso)),
    input,
    cadence,
    upcoming: rows.slice(0, 30).map((r) => ({
      id: r.id,
      status: r.status,
      scheduledFor: r.scheduled_for,
      platforms: r.platforms ?? ["facebook"],
      hook: (r.hook ?? r.caption ?? "").split("\n")[0].slice(0, 120),
      lastError: r.last_error ?? null,
      attempts: r.attempts ?? 0,
    })),
  };
}
