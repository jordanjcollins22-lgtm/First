import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { notifyTeamMember } from "@/lib/notifications";
import { mergeSettings, type SequenceKey, type SequenceSetting, type StoredSetting } from "@/lib/client-automations/settings";

/**
 * The shared plumbing for the A2 automations: the switches, the list of
 * things that need a person, and "when did this client last say anything".
 *
 * These tables are newer than the generated types, so the client is cast,
 * the way data/website.ts does it.
 */

export const untyped = (client: unknown) => client as SupabaseClient;

export async function loadSequenceSettings(client: unknown, organizationId: string): Promise<Record<SequenceKey, SequenceSetting> & { ready: boolean }> {
  const sb = untyped(client);
  const { data, error } = await sb
    .from("client_automation_settings")
    .select("sequence, enabled, started_at, config")
    .eq("organization_id", organizationId);
  // Before the migration is applied the table is missing: every sequence
  // reads as off, which is the safe answer.
  return Object.assign(mergeSettings((data ?? []) as StoredSetting[]), { ready: !error });
}

export interface AutomationExceptionInput {
  organizationId: string;
  kind: "collections" | "low_rating";
  summary: string;
  detail?: string | null;
  customerId?: string | null;
  jobId?: string | null;
  referenceId?: string | null;
  dedupeKey: string;
}

/**
 * Hand something to a person. Once per dedupe key, ever: a second run finds
 * the first and does nothing, and a resolved one stays resolved. The owner is
 * told by text the first time, through the usual notification preferences.
 */
export async function openAutomationException(input: AutomationExceptionInput): Promise<boolean> {
  const admin = untyped(createAdminClient());
  const { data, error } = await admin
    .from("client_automation_exceptions")
    .upsert(
      {
        organization_id: input.organizationId,
        kind: input.kind,
        summary: input.summary.slice(0, 300),
        detail: input.detail?.slice(0, 4000) ?? null,
        customer_id: input.customerId ?? null,
        job_id: input.jobId ?? null,
        reference_id: input.referenceId ?? null,
        dedupe_key: input.dedupeKey,
      },
      { onConflict: "organization_id,dedupe_key", ignoreDuplicates: true }
    )
    .select("id");
  if (error) {
    log.warn("client_automation.exception_failed", { kind: input.kind, error: error.message });
    return false;
  }
  const created = (data ?? []).length > 0;
  if (created) {
    for (const ownerId of await ownerIds(input.organizationId)) {
      await notifyTeamMember(ownerId, "client_messages", `${input.summary} Open Sales › Automated messages.`, {
        dedupeKey: `automation_exception:${input.dedupeKey}:${ownerId}`,
      }).catch(() => false);
    }
  }
  return created;
}

/** The owner-level people of a business, who get told about exceptions. */
export async function ownerIds(organizationId: string): Promise<string[]> {
  const admin = createAdminClient();
  const [{ data: profiles }, { data: roles }] = await Promise.all([
    admin.from("profiles").select("id").eq("organization_id", organizationId),
    admin.from("profile_roles").select("profile_id, role_name"),
  ]);
  const inOrg = new Set((profiles ?? []).map((p) => p.id));
  return [...new Set((roles ?? []).filter((r) => inOrg.has(r.profile_id) && ["owner", "admin"].includes(String(r.role_name).toLowerCase())).map((r) => r.profile_id))];
}

/**
 * The last time each client said anything to us, on any channel the app
 * stores: a text (Twilio or GoHighLevel), an email reply, a message on a
 * proposal or job page, a call they made, or a call where we reached them.
 * Everything a client writes is filed in job_messages as author_type
 * 'client' by those webhooks, so that one table is most of the answer.
 */
export async function lastClientContact(client: unknown, customerIds: string[]): Promise<Map<string, Date>> {
  const sb = untyped(client);
  const ids = [...new Set(customerIds)].filter(Boolean);
  const out = new Map<string, Date>();
  const bump = (customerId: string | null | undefined, at: string | null | undefined) => {
    if (!customerId || !at) return;
    const d = new Date(at);
    const held = out.get(customerId);
    if (!held || held < d) out.set(customerId, d);
  };

  for (let i = 0; i < ids.length; i += 150) {
    const slice = ids.slice(i, i + 150);
    const [messages, calls, voice] = await Promise.all([
      sb
        .from("job_messages")
        .select("created_at, job:jobs!inner(property:properties!inner(customer_id))")
        .eq("author_type", "client")
        .in("job.property.customer_id", slice)
        .order("created_at", { ascending: false })
        .limit(2000),
      sb.from("proposal_calls").select("customer_id, created_at, outcome").in("customer_id", slice).neq("outcome", "no_answer").limit(2000),
      sb.from("voice_calls").select("customer_id, created_at, direction, missed").in("customer_id", slice).limit(2000),
    ]);
    for (const row of (messages.data ?? []) as unknown as { created_at: string; job: { property: { customer_id: string } | null } | null }[]) {
      bump(row.job?.property?.customer_id, row.created_at);
    }
    for (const row of (calls.data ?? []) as { customer_id: string | null; created_at: string }[]) bump(row.customer_id, row.created_at);
    // A call they made counts whether or not we answered: they reached out.
    for (const row of (voice.data ?? []) as { customer_id: string | null; created_at: string; direction: string; missed: boolean }[]) {
      if (row.direction === "inbound" || !row.missed) bump(row.customer_id, row.created_at);
    }
  }
  return out;
}
