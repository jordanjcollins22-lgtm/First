import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { log, maskPhone } from "@/lib/log";
import { last10Digits } from "@/lib/sms";
import { notifyJobTeam, notifyTeamMember } from "@/lib/notifications";
import { inboundIntent } from "@/lib/client-consent";
import { recordConsent } from "@/lib/data/client-messaging";
import type { InboundMessage } from "@/lib/ghl/inbox";

/**
 * Keeps one inbound GoHighLevel message, files it where the team works,
 * and tells the right person. Safe to call twice for the same message:
 * the row is claimed on GoHighLevel's message id first, and only the call
 * that made the row files and announces it.
 *
 * Nothing is thrown away any more. The old webhook dropped a text from a
 * number with no client (a new lead) and a client with no job yet; both
 * now land in ghl_inbound_messages and reach the account manager.
 */

// ghl_inbound_messages is newer than the generated types.
type Db = SupabaseClient;

export const JS_ORG_ID = "00000000-0000-0000-0000-000000000001";

export interface CaptureResult {
  stored: boolean;
  duplicate: boolean;
  customerId: string | null;
  jobId: string | null;
  alerted: number;
}

function fallbackKey(m: InboundMessage): string {
  // A body with no message id (a hand-built webhook) still needs a key that
  // a retry of the same message reproduces.
  const who = m.contactId ?? m.phone ?? m.email ?? "unknown";
  const minute = m.receivedAt.slice(0, 16);
  let hash = 0;
  for (const ch of m.body) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return `nokey:${who}:${minute}:${(hash >>> 0).toString(36)}`;
}

async function findCustomer(admin: Db, organizationId: string, m: InboundMessage) {
  if (m.contactId) {
    const { data } = await admin
      .from("customers")
      .select("id, name, phone, account_manager_id, organization_id")
      .eq("organization_id", organizationId)
      .eq("ghl_contact_id", m.contactId)
      .limit(1);
    if (data?.[0]) return data[0];
  }
  if (m.phone) {
    const digits = last10Digits(m.phone);
    if (digits.length === 10) {
      const { data } = await admin
        .from("customers")
        .select("id, name, phone, account_manager_id, organization_id")
        .eq("organization_id", organizationId)
        .ilike("phone", `%${digits.slice(-4)}%`);
      const hit = (data ?? []).find((c) => c.phone && last10Digits(c.phone) === digits);
      if (hit) return hit;
    }
  }
  if (m.email) {
    const { data } = await admin
      .from("customers")
      .select("id, name, phone, account_manager_id, organization_id")
      .eq("organization_id", organizationId)
      .ilike("email", m.email)
      .limit(1);
    if (data?.[0]) return data[0];
  }
  return null;
}

async function latestJobFor(admin: Db, customerId: string): Promise<string | null> {
  const { data: properties } = await admin.from("properties").select("id").eq("customer_id", customerId);
  const ids = (properties ?? []).map((p: { id: string }) => p.id);
  if (ids.length === 0) return null;
  const { data: jobs } = await admin
    .from("jobs")
    .select("id")
    .in("property_id", ids)
    .order("created_at", { ascending: false })
    .limit(1);
  return (jobs?.[0] as { id: string } | undefined)?.id ?? null;
}

async function isTeamMember(admin: Db, organizationId: string, m: InboundMessage): Promise<boolean> {
  const digits = m.phone ? last10Digits(m.phone) : "";
  if (digits.length !== 10 && !m.email) return false;
  const { data } = await admin.from("profiles").select("phone, email").eq("organization_id", organizationId);
  return ((data ?? []) as { phone: string | null; email: string | null }[]).some(
    (p) =>
      (digits.length === 10 && p.phone && last10Digits(p.phone) === digits) ||
      (m.channel === "Email" && m.email && p.email && p.email.toLowerCase() === m.email.toLowerCase())
  );
}

/** Account managers, else admins: who hears about a message with no job. */
async function frontDesk(admin: Db, organizationId: string): Promise<string[]> {
  const { data } = await admin
    .from("profile_roles")
    .select("profile_id, role_name, profile:profiles!inner(organization_id)")
    .in("role_name", ["account manager", "account_manager", "admin", "owner"])
    .eq("profile.organization_id", organizationId);
  const rows = (data ?? []) as { profile_id: string; role_name: string }[];
  const managers = rows.filter((r) => r.role_name.replace("_", " ") === "account manager").map((r) => r.profile_id);
  const pick = managers.length > 0 ? managers : rows.map((r) => r.profile_id);
  return Array.from(new Set(pick));
}

export async function captureInbound(
  message: InboundMessage,
  via: "webhook" | "sweep",
  options: { organizationId?: string; raw?: unknown } = {}
): Promise<CaptureResult> {
  const admin = createAdminClient() as unknown as Db;
  const organizationId = options.organizationId ?? JS_ORG_ID;
  const key = message.ghlMessageId ?? fallbackKey(message);

  if (await isTeamMember(admin, organizationId, message)) {
    // Jace or Jordan texting the business line (drafts, notes to self) is
    // not a client message.
    return { stored: false, duplicate: false, customerId: null, jobId: null, alerted: 0 };
  }

  const customer = await findCustomer(admin, organizationId, message);

  const { data: claimed, error: claimError } = await admin
    .from("ghl_inbound_messages")
    .upsert(
      {
        organization_id: organizationId,
        ghl_message_id: key,
        conversation_id: message.conversationId,
        contact_id: message.contactId,
        phone: message.phone,
        email: message.email,
        contact_name: message.name,
        channel: message.channel,
        body: message.body,
        received_at: message.receivedAt,
        captured_via: via,
        customer_id: customer?.id ?? null,
        raw: options.raw ?? null,
      },
      { onConflict: "ghl_message_id", ignoreDuplicates: true }
    )
    .select("id");
  if (claimError) {
    log.error("ghl.capture.failed", claimError, { via });
    throw new Error(`Could not save the HighLevel message: ${claimError.message}`);
  }
  const rowId = (claimed?.[0] as { id: string } | undefined)?.id;
  if (!rowId) return { stored: false, duplicate: true, customerId: customer?.id ?? null, jobId: null, alerted: 0 };

  const who = message.name || customer?.name || (message.phone ? maskPhone(message.phone) : null) || "Someone";
  const intent = inboundIntent(message.body);

  if (customer && message.channel === "SMS" && (intent === "stop" || intent === "start")) {
    await recordConsent({
      organizationId,
      customerId: customer.id,
      channel: "sms",
      state: intent === "stop" ? "revoked" : "granted",
      source: "reply",
      evidence: `Replied "${message.body.slice(0, 60)}" via GoHighLevel on ${message.receivedAt}`,
    }).catch(() => {});
  }

  const jobId = customer ? await latestJobFor(admin, customer.id) : null;
  let jobMessageId: string | null = null;
  if (jobId) {
    const { data: saved } = await admin
      .from("job_messages")
      .insert({
        job_id: jobId,
        organization_id: organizationId,
        channel: "external",
        author_type: "client",
        author_name: who,
        body: intent === "message" ? message.body : `${message.body} (handled automatically: ${intent})`,
        sent_via: message.channel === "Email" ? "email" : "sms",
      })
      .select("id")
      .maybeSingle();
    jobMessageId = (saved as { id: string } | null)?.id ?? null;
  }

  const where = message.channel === "SMS" ? "texted" : `wrote on ${message.channel.replace("_", " ")}`;
  const alertText = `${who} ${where}: ${message.body.slice(0, 140)}${customer ? "" : " (new number, not a client yet)"}`;
  let alerted = 0;
  if (jobId) {
    await notifyJobTeam(jobId, "client_messages", alertText, { dedupeKey: `ghl:${rowId}` }).catch(() => {});
    alerted = 1;
  } else {
    const people = customer?.account_manager_id ? [customer.account_manager_id] : await frontDesk(admin, organizationId);
    const sent = await Promise.all(
      people.map((id) =>
        notifyTeamMember(id, "client_messages", alertText, { dedupeKey: `ghl:${rowId}`, overridesKindPreference: true }).catch(() => false)
      )
    );
    alerted = sent.filter(Boolean).length;
  }

  await admin
    .from("ghl_inbound_messages")
    .update({ job_id: jobId, job_message_id: jobMessageId, alerted_at: new Date().toISOString() })
    .eq("id", rowId);

  log.info("ghl.capture.stored", { via, channel: message.channel, matched: Boolean(customer), jobId });
  return { stored: true, duplicate: false, customerId: customer?.id ?? null, jobId, alerted };
}
