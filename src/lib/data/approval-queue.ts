import type { SupabaseClient } from "@supabase/supabase-js";

import { log } from "@/lib/log";
import { whatLabel } from "@/lib/outbound-approval";
import { HOLD_REASON_LABEL, type HoldReason } from "@/lib/approvals/policy";
import { exceptionNeedsOwner, sortQueue, type QueueItem, type QueueType } from "@/lib/approvals/queue";
import { topDeclineReasons, type DeclineReason, type ReasonCount } from "@/lib/approvals/declines";
import { KIND_LABEL as PLAY_LABEL, shortAddress, type PlayKind } from "@/lib/marketing-plays";
import { KIND_LABEL as EXCEPTION_LABEL, isExceptionKind } from "@/lib/exceptions";
import { backOfficeQueueItems } from "@/lib/data/back-office-queue";

/**
 * Everything waiting on the owner, read from where each thing already
 * lives. Nothing is copied into a queue table: a held email is still an
 * outbound_approvals row, a price is still a job_proposals row, so the
 * existing screens and actions keep working and nothing can drift.
 *
 * Each source is read on its own and a failure in one leaves the rest of
 * the list standing.
 */

type Db = SupabaseClient;
function loose(client: unknown): Db {
  return client as Db;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

async function safely<T>(source: string, work: () => Promise<T[]>): Promise<T[]> {
  try {
    return await work();
  } catch (err) {
    log.warn("approval_queue.source_failed", { source, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

export async function loadApprovalQueue(client: unknown, organizationId: string, now = new Date()): Promise<QueueItem[]> {
  const db = loose(client);
  const lists = await Promise.all([
    safely("email", () => heldEmails(db, organizationId)),
    safely("price", () => pricesToApprove(db, organizationId)),
    safely("play", () => playsToApprove(db, organizationId)),
    safely("social", () => postsToSend(db, organizationId, now)),
    safely("pm_draft", () => pmDrafts(db, organizationId)),
    safely("exception", () => escalatedExceptions(db, organizationId, now)),
    safely("back_office", () => backOfficeItems(organizationId, now)),
  ]);
  return sortQueue(lists.flat());
}

/**
 * Payouts to approve, licenses and filings coming due, new-hire items late,
 * people with no role: read live from the back office each time, since they
 * disappear by themselves once dealt with.
 */
async function backOfficeItems(organizationId: string, now: Date): Promise<QueueItem[]> {
  const items = await backOfficeQueueItems(organizationId, now);
  return items.map((i) => ({
    type: "back_office" as const,
    id: i.action?.arg ?? i.key,
    title: i.title,
    detail: i.detail,
    kind: i.kind,
    since: i.at ?? now.toISOString(),
    dueAt: null,
    href: i.href,
    canApprove: Boolean(i.action),
    approveLabel: i.amount != null ? `Approve ${money(i.amount)}` : "Approve",
    canDecline: false,
  }));
}

async function heldEmails(db: Db, organizationId: string): Promise<QueueItem[]> {
  const { data, error } = await db
    .from("outbound_approvals")
    .select("id, kind, to_email, to_name, subject, body, expires_at, created_at, job_id, payload")
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw error;
  type Row = { id: string; kind: string; to_email: string; to_name: string | null; subject: string; body: string; expires_at: string | null; created_at: string; job_id: string | null; payload: { held_because?: string } | null };
  return ((data ?? []) as Row[]).map((row) => {
    const why = row.payload?.held_because as HoldReason | undefined;
    return {
      type: "email" as const,
      id: row.id,
      title: `${whatLabel(row.kind)} to ${row.to_name?.trim() || row.to_email}`,
      detail: [row.subject, why && HOLD_REASON_LABEL[why] ? HOLD_REASON_LABEL[why] : null].filter(Boolean).join(" · "),
      kind: row.kind,
      since: row.created_at,
      dueAt: row.expires_at,
      href: row.job_id ? `/jobs/${row.job_id}` : "/my-day#approvals",
      canApprove: true,
      approveLabel: "Send",
      canDecline: true,
      body: row.body,
    };
  });
}

async function pricesToApprove(db: Db, organizationId: string): Promise<QueueItem[]> {
  const { data, error } = await db
    .from("job_proposals")
    .select("id, job_id, total_cost, discount_amount, generated_at, created_at, job:jobs(name, property:properties(address, customer:customers(name)))")
    .eq("organization_id", organizationId)
    .eq("status", "needs_approval")
    .limit(50);
  if (error) throw error;
  type Row = {
    id: string;
    job_id: string;
    total_cost: number | null;
    discount_amount: number | null;
    generated_at: string | null;
    created_at: string;
    job: { name: string | null; property: { address: string; customer: { name: string } | null } | null } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((row) => {
    const total = Number(row.total_cost ?? 0) - Number(row.discount_amount ?? 0);
    const who = row.job?.property?.customer?.name ?? null;
    const where = row.job?.property?.address ? shortAddress(row.job.property.address) : row.job?.name ?? "a job";
    return {
      type: "price" as const,
      id: row.job_id,
      title: `Price ${money(total)} for ${who ?? where}`,
      detail: who ? where : null,
      kind: "price",
      since: row.generated_at ?? row.created_at,
      dueAt: null,
      href: `/jobs/${row.job_id}`,
      canApprove: total > 0,
      approveLabel: "Accept price",
      canDecline: true,
    };
  });
}

async function playsToApprove(db: Db, organizationId: string): Promise<QueueItem[]> {
  const { data, error } = await db
    .from("marketing_plays")
    .select("id, kind, quantity, reason, house_id, created_at")
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .eq("approval", "pending")
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw error;
  type Row = { id: string; kind: string; quantity: number; reason: string; house_id: string; created_at: string };
  const rows = (data ?? []) as Row[];
  const houseIds = [...new Set(rows.map((r) => r.house_id))];
  const addresses = new Map<string, string>();
  if (houseIds.length > 0) {
    const { data: houses } = await db.from("houses").select("id, address").in("id", houseIds);
    for (const h of (houses ?? []) as { id: string; address: string }[]) addresses.set(h.id, h.address);
  }
  return rows.map((row) => {
    const label = PLAY_LABEL[row.kind as PlayKind] ?? row.kind.replace(/_/g, " ");
    const at = addresses.get(row.house_id);
    return {
      type: "play" as const,
      id: row.id,
      title: `${label}${row.quantity > 1 ? ` × ${row.quantity.toLocaleString("en-US")}` : ""}${at ? ` round ${shortAddress(at)}` : ""}`,
      detail: row.reason === "client" ? "After a new client" : row.reason === "evaluation" ? "After an evaluation" : null,
      kind: row.kind,
      since: row.created_at,
      dueAt: null,
      href: "/attractors",
      canApprove: true,
      approveLabel: "Approve",
      canDecline: true,
    };
  });
}

async function postsToSend(db: Db, organizationId: string, now: Date): Promise<QueueItem[]> {
  const { data, error } = await db
    .from("social_posts")
    .select("id, caption, hook, scheduled_for, placement, created_at")
    .eq("organization_id", organizationId)
    .eq("status", "scheduled")
    .lte("scheduled_for", now.toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(50);
  if (error) throw error;
  type Row = { id: string; caption: string | null; hook: string | null; scheduled_for: string; placement: string | null; created_at: string };
  return ((data ?? []) as Row[]).map((row) => {
    const words = (row.hook || row.caption || "").replace(/\s+/g, " ").trim();
    return {
      type: "social" as const,
      id: row.id,
      title: row.placement === "group" ? "Group post to share by hand" : "Scheduled post that hasn't gone out",
      detail: words ? (words.length > 90 ? `${words.slice(0, 87)}…` : words) : null,
      kind: row.placement === "group" ? "group_post" : "page_post",
      since: row.scheduled_for,
      dueAt: null,
      href: "/admin/social",
      canApprove: true,
      approveLabel: "Mark posted",
      canDecline: true,
    };
  });
}

async function pmDrafts(db: Db, organizationId: string): Promise<QueueItem[]> {
  const { data, error } = await db
    .from("pm_companies")
    .select("id, name, contact_name, email, updated_at")
    .eq("organization_id", organizationId)
    .eq("status", "drafted")
    .order("updated_at", { ascending: true })
    .limit(50);
  if (error) throw error;
  type Row = { id: string; name: string; contact_name: string | null; email: string | null; updated_at: string };
  return ((data ?? []) as Row[]).map((row) => ({
    type: "pm_draft" as const,
    id: row.id,
    title: `Emails to ${row.name}`,
    detail: row.email ? `${row.contact_name ? `${row.contact_name}, ` : ""}${row.email}` : "No email address yet",
    kind: "pm_draft",
    since: row.updated_at,
    dueAt: null,
    href: "/marketing",
    canApprove: Boolean(row.email),
    approveLabel: "Approve emails",
    canDecline: true,
  }));
}

async function escalatedExceptions(db: Db, organizationId: string, now: Date): Promise<QueueItem[]> {
  const { data, error } = await db
    .from("job_exceptions")
    .select("id, job_id, kind, state, summary, blocks_work, reported_at")
    .eq("organization_id", organizationId)
    .in("state", ["reported", "acknowledged"])
    .order("reported_at", { ascending: true })
    .limit(100);
  if (error) throw error;
  type Row = { id: string; job_id: string; kind: string; state: string; summary: string; blocks_work: boolean; reported_at: string };
  return ((data ?? []) as Row[])
    .filter((row) => exceptionNeedsOwner({ state: row.state, blocksWork: row.blocks_work, reportedAt: row.reported_at }, now))
    .map((row) => ({
      type: "exception" as const,
      id: row.id,
      title: `${isExceptionKind(row.kind) ? EXCEPTION_LABEL[row.kind] : row.kind.replace(/_/g, " ")}${row.blocks_work ? " (work stopped)" : ""}`,
      detail: row.summary,
      kind: row.kind,
      since: row.reported_at,
      dueAt: null,
      href: `/jobs/${row.job_id}`,
      canApprove: row.state === "reported",
      approveLabel: "Pick it up",
      canDecline: true,
    }));
}

/** Every "no" from the queue, kept so the top reasons can be read back. */
export async function recordDecline(
  client: unknown,
  input: { organizationId: string; itemType: QueueType; itemId: string; itemKind: string | null; reason: DeclineReason; note: string | null; decidedBy: string }
): Promise<void> {
  const { error } = await loose(client).from("approval_declines").insert({
    organization_id: input.organizationId,
    item_type: input.itemType,
    item_id: input.itemId,
    item_kind: input.itemKind,
    reason: input.reason,
    note: input.note?.trim() || null,
    decided_by: input.decidedBy,
  });
  if (error) log.warn("approval_queue.decline_not_recorded", { error: error.message });
}

export interface DeclineReport {
  since: string;
  total: number;
  top: ReasonCount[];
  /** Held emails over the same window, for the decline rate. */
  emailsDecided: number;
  emailsDeclined: number;
  /** Closed by the app itself because they no longer made sense. */
  emailsMoot: number;
}

/** The top reasons the owner said no, over the last few weeks. */
export async function declineReport(client: unknown, organizationId: string, days = 28, now = new Date()): Promise<DeclineReport> {
  const db = loose(client);
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const [{ data: declines }, { data: emails }] = await Promise.all([
    db.from("approval_declines").select("reason, item_type, item_kind").eq("organization_id", organizationId).gte("decided_at", since).limit(1000),
    db
      .from("outbound_approvals")
      .select("status, moot_reason")
      .eq("organization_id", organizationId)
      .neq("status", "pending")
      .gte("decided_at", since)
      .limit(2000),
  ]);
  const rows = ((declines ?? []) as { reason: string; item_type: string; item_kind: string | null }[]).map((r) => ({
    reason: r.reason,
    itemType: r.item_type,
    itemKind: r.item_kind,
  }));
  const decided = (emails ?? []) as { status: string; moot_reason: string | null }[];
  return {
    since,
    total: rows.length,
    top: topDeclineReasons(rows),
    emailsDecided: decided.filter((e) => !e.moot_reason).length,
    emailsDeclined: decided.filter((e) => e.status === "declined").length,
    emailsMoot: decided.filter((e) => e.moot_reason).length,
  };
}

/** The first moment the per-kind policy was in force. Written once. */
export async function markPolicyStarted(client: unknown, organizationId: string, by: string | null): Promise<void> {
  const db = loose(client);
  const now = new Date().toISOString();
  await db.from("approval_settings").upsert({ organization_id: organizationId }, { onConflict: "organization_id", ignoreDuplicates: true });
  await db
    .from("approval_settings")
    .update({ policy_started_at: now, updated_at: now, updated_by: by })
    .eq("organization_id", organizationId)
    .is("policy_started_at", null);
}
