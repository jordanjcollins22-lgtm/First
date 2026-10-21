import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { CONTROLS_OFF, type Controls } from "@/lib/os/store";

/**
 * What the attention page shows: every open item that needs a person, from
 * every place the app keeps them, and whether the automations are healthy.
 *
 * Read through the signed-in person's own row security. Null when the
 * backbone's tables are not in this database yet, so the page can say so
 * rather than show an empty list that reads as "nothing to do".
 */

export interface AttentionItem {
  source: string;
  id: string;
  jobId: string | null;
  summary: string;
  severity: string;
  ownerId: string | null;
  dueAt: string | null;
  createdAt: string;
  blocking: boolean;
}

export interface AutomationHealth {
  controls: Controls;
  /** Facts recorded in the last day. */
  eventsToday: number;
  /** Deliveries waiting, failing, or given up on. */
  pending: number;
  failing: number;
  dead: number;
  /** Follow-ups decided on paper, in dry run, in the last week. */
  proposedThisWeek: number;
  skippedThisWeek: number;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, blocking: 1, warning: 2, info: 3 };

export async function getAttention(): Promise<{ items: AttentionItem[]; health: AutomationHealth } | null> {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const organizationId = await getCurrentOrganizationId();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0);

  const { data: items, error } = await supabase
    .from("action_required_items")
    .select("source, id, job_id, summary, severity, owner_id, due_at, created_at, blocking")
    .eq("organization_id", organizationId)
    .limit(500);
  if (error) return null;

  const [{ data: controls }, eventsToday, pending, failing, dead, proposedThisWeek, skippedThisWeek] = await Promise.all([
    supabase.from("automation_controls").select("events_enabled, dry_run, paused").eq("organization_id", organizationId).maybeSingle(),
    count(supabase.from("domain_events").select("event_id", { count: "exact", head: true }).eq("organization_id", organizationId).gte("recorded_at", dayAgo)),
    count(supabase.from("outbox_messages").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).in("status", ["pending", "processing"])),
    count(supabase.from("outbox_messages").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "failed")),
    count(supabase.from("outbox_messages").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "dead")),
    count(supabase.from("automation_actions").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "proposed").gte("updated_at", weekAgo)),
    count(supabase.from("automation_actions").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "skipped").gte("updated_at", weekAgo)),
  ]);

  const list: AttentionItem[] = ((items ?? []) as Record<string, unknown>[]).map((row) => ({
    source: row.source as string,
    id: row.id as string,
    jobId: (row.job_id as string | null) ?? null,
    summary: row.summary as string,
    severity: row.severity as string,
    ownerId: (row.owner_id as string | null) ?? null,
    dueAt: (row.due_at as string | null) ?? null,
    createdAt: row.created_at as string,
    blocking: Boolean(row.blocking),
  }));
  // Worst first, then whatever is due soonest. A low aggregate never hides one.
  list.sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
      (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity)
  );

  return {
    items: list,
    health: {
      controls: controls
        ? { eventsEnabled: Boolean(controls.events_enabled), dryRun: controls.dry_run !== false, paused: Boolean(controls.paused) }
        : CONTROLS_OFF,
      eventsToday,
      pending,
      failing,
      dead,
      proposedThisWeek,
      skippedThisWeek,
    },
  };
}
