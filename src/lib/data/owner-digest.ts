import type { SupabaseClient } from "@supabase/supabase-js";

import { log } from "@/lib/log";
import { outboundBaseUrl } from "@/lib/base-url";
import { notifyTeamMember } from "@/lib/notifications";
import { countByType, QUEUE_TYPE_LABEL, QUEUE_TYPES } from "@/lib/approvals/queue";
import { composeDigest, digestKey, isOverdue, lastWeek, type WeekKpis } from "@/lib/approvals/digest";
import { KIND_LABEL as EXCEPTION_LABEL, isExceptionKind } from "@/lib/exceptions";
import { loadApprovalQueue } from "@/lib/data/approval-queue";
import { loadPolicy } from "@/lib/data/approval-policy";

/**
 * The Monday digest, read and sent.
 *
 * Owner only, through notifyTeamMember: a text where there is a text line
 * and a number, an email otherwise, and the person's own "notifications
 * off" still means off. Sent once per week per owner, whoever calls it and
 * however often, because the week is the dedupe key.
 */

type Db = SupabaseClient;
function loose(client: unknown): Db {
  return client as Db;
}

const sum = (rows: { amount: number | string | null }[]) => rows.reduce((t, r) => t + Number(r.amount ?? 0), 0);

/** Last week's numbers per department. */
export async function loadWeekKpis(client: unknown, organizationId: string, week: { start: Date; end: Date }, now = new Date()): Promise<WeekKpis> {
  const db = loose(client);
  const from = week.start.toISOString();
  const to = week.end.toISOString();
  const count = (r: { count: number | null }) => r.count ?? 0;

  const [leads, booked, sent, won, lost, invoiced, collected, open, completed] = await Promise.all([
    db.from("customers").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).gte("created_at", from).lt("created_at", to),
    db
      .from("jobs")
      .select("id, property:properties!inner(customer:customers!inner(organization_id))", { count: "exact", head: true })
      .eq("property.customer.organization_id", organizationId)
      .not("evaluation_date", "is", null)
      .neq("evaluation_status", "cancelled")
      .gte("created_at", from)
      .lt("created_at", to),
    db.from("job_proposals").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).gte("sent_at", from).lt("sent_at", to),
    db.from("job_proposals").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).in("status", ["accepted", "paid"]).gte("responded_at", from).lt("responded_at", to),
    db.from("job_proposals").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "declined").gte("responded_at", from).lt("responded_at", to),
    db.from("invoices").select("amount").eq("organization_id", organizationId).not("status", "in", "(void)").gte("created_at", from).lt("created_at", to).limit(2000),
    db.from("invoices").select("amount").eq("organization_id", organizationId).eq("status", "paid").gte("paid_at", from).lt("paid_at", to).limit(2000),
    db.from("invoices").select("amount, status, sent_at, created_at").eq("organization_id", organizationId).eq("status", "open").limit(2000),
    db
      .from("jobs")
      .select("id, property:properties!inner(customer:customers!inner(organization_id))", { count: "exact", head: true })
      .eq("property.customer.organization_id", organizationId)
      .gte("completed_at", from)
      .lt("completed_at", to),
  ]);

  const overdue = ((open.data ?? []) as { amount: number; status: string; sent_at: string | null; created_at: string }[]).filter((i) =>
    isOverdue({ status: i.status, sentAt: i.sent_at, createdAt: i.created_at }, now)
  );

  return {
    marketing: { leads: count(leads) },
    sales: {
      bookedEvaluations: count(booked),
      proposalsSent: count(sent),
      proposalsWon: count(won),
      proposalsLost: count(lost),
    },
    operations: { jobsCompleted: count(completed) },
    admin: {
      invoiced: sum((invoiced.data ?? []) as { amount: number }[]),
      collected: sum((collected.data ?? []) as { amount: number }[]),
      arOverdue: sum(overdue),
      arOverdueCount: overdue.length,
    },
  };
}

/** The open exceptions most worth the owner's eye: work stopped first, then oldest. */
export async function topExceptions(client: unknown, organizationId: string, limit = 5): Promise<{ title: string; detail: string | null }[]> {
  const { data } = await loose(client)
    .from("job_exceptions")
    .select("kind, summary, blocks_work, reported_at")
    .eq("organization_id", organizationId)
    .in("state", ["reported", "acknowledged"])
    .order("blocks_work", { ascending: false })
    .order("reported_at", { ascending: true })
    .limit(limit);
  return ((data ?? []) as { kind: string; summary: string; blocks_work: boolean }[]).map((e) => ({
    title: `${isExceptionKind(e.kind) ? EXCEPTION_LABEL[e.kind] : e.kind.replace(/_/g, " ")}${e.blocks_work ? " (work stopped)" : ""}`,
    detail: e.summary.length > 80 ? `${e.summary.slice(0, 77)}…` : e.summary,
  }));
}

/** The owners of a business: whoever holds the owner role. */
export async function ownersOf(client: unknown, organizationId: string): Promise<string[]> {
  const db = loose(client);
  const { data: people } = await db.from("profiles").select("id").eq("organization_id", organizationId);
  const ids = ((people ?? []) as { id: string }[]).map((p) => p.id);
  if (ids.length === 0) return [];
  const { data: roles } = await db.from("profile_roles").select("profile_id, role_name").in("profile_id", ids);
  return [
    ...new Set(
      ((roles ?? []) as { profile_id: string; role_name: string }[])
        .filter((r) => r.role_name.trim().toLowerCase() === "owner")
        .map((r) => r.profile_id)
    ),
  ];
}

export interface DigestPreview {
  subject: string;
  text: string;
  queueCount: number;
}

/** The digest as it would go now, without sending it. */
export async function buildDigest(client: unknown, organizationId: string, now = new Date()): Promise<DigestPreview> {
  const db = loose(client);
  const week = lastWeek(now);
  const [{ data: org }, queue, kpis, exceptions] = await Promise.all([
    db.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
    loadApprovalQueue(db, organizationId, now),
    loadWeekKpis(db, organizationId, week, now),
    topExceptions(db, organizationId),
  ]);
  const counts = countByType(queue);
  const note = composeDigest({
    businessName: (org as { name?: string } | null)?.name ?? "Your business",
    week,
    queueCount: queue.length,
    queueByType: QUEUE_TYPES.map((t) => ({ label: QUEUE_TYPE_LABEL[t], count: counts[t] })),
    kpis,
    exceptions,
    link: `${(await outboundBaseUrl()).replace(/\/$/, "")}/v2`,
  });
  return { ...note, queueCount: queue.length };
}

export type DigestOutcome = { organizationId: string; sent: number; skipped: string | null };

/**
 * Send this week's digest to the owners of one business, once.
 *
 * The digest switch is checked here and its start recorded the first time
 * it runs on, so "when did this start" has an answer.
 */
export async function sendOwnerDigest(client: unknown, organizationId: string, now = new Date()): Promise<DigestOutcome> {
  const db = loose(client);
  const policy = await loadPolicy(db, organizationId);
  if (!policy.digestEnabled) return { organizationId, sent: 0, skipped: "digest is switched off" };

  const owners = await ownersOf(db, organizationId);
  if (owners.length === 0) return { organizationId, sent: 0, skipped: "no one holds the owner role" };

  const digest = await buildDigest(db, organizationId, now);
  const key = digestKey(now);
  let sent = 0;
  for (const owner of owners) {
    const ok = await notifyTeamMember(owner, "owner_digest", digest.text, { dedupeKey: key, overridesKindPreference: true }).catch((err: unknown) => {
      log.warn("owner_digest.failed", { organizationId, error: err instanceof Error ? err.message : String(err) });
      return false;
    });
    if (ok) sent += 1;
  }

  const stamp = now.toISOString();
  await db.from("approval_settings").upsert({ organization_id: organizationId }, { onConflict: "organization_id", ignoreDuplicates: true });
  await db.from("approval_settings").update({ digest_started_at: stamp }).eq("organization_id", organizationId).is("digest_started_at", null);
  if (sent > 0) await db.from("approval_settings").update({ digest_last_sent_at: stamp }).eq("organization_id", organizationId);
  log.info("owner_digest.done", { organizationId, sent, owners: owners.length, waiting: digest.queueCount });
  return { organizationId, sent, skipped: null };
}
