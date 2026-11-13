import type { SupabaseClient } from "@supabase/supabase-js";

import { handleInboundSms } from "@/lib/check-ins/service";
import { normalizePhone } from "@/lib/check-ins/phone";
import { serverEnv } from "@/lib/env";
import type { InboundMessage } from "@/lib/ghl/inbound";
import type { Database } from "@/lib/supabase/database.types";
import type { TeamMember } from "@/types/domain";

import { runCommsAgent, type SenderKind } from "./agent";
import { notifyManagers } from "./messaging";

type Db = SupabaseClient<Database>;

const HISTORY_LIMIT = 15;

/**
 * Log an inbound message. Returns null when GHL already delivered this
 * message (webhook retry), so it's never handled twice.
 */
export async function recordInbound(supabase: Db, inbound: InboundMessage): Promise<{ id: string } | null> {
  const row = {
    channel: inbound.channel,
    direction: "inbound" as const,
    ghl_contact_id: inbound.contactId,
    ghl_conversation_id: inbound.conversationId,
    ghl_message_id: inbound.messageId,
    contact_name: inbound.name,
    contact_address: inbound.phone ?? inbound.email,
    subject: inbound.subject,
    body: inbound.body,
  };
  if (!inbound.messageId) {
    const { data, error } = await supabase.from("comm_messages").insert(row).select("id").single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from("comm_messages")
    .upsert(row, { onConflict: "ghl_message_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw error;
  return data?.[0] ?? null;
}

async function findTeamMember(supabase: Db, inbound: InboundMessage): Promise<TeamMember | null> {
  if (inbound.contactId) {
    const { data } = await supabase
      .from("team_members")
      .select("*")
      .eq("ghl_contact_id", inbound.contactId)
      .eq("active", true)
      .maybeSingle();
    if (data) return data as unknown as TeamMember;
  }
  const phone = normalizePhone(inbound.phone);
  if (!phone) return null;
  const { data } = await supabase.from("team_members").select("*").eq("phone", phone).eq("active", true).maybeSingle();
  return (data as unknown as TeamMember | null) ?? null;
}

/** What the app knows about a non-employee sender, as short facts for the agent. */
async function customerFacts(supabase: Db, inbound: InboundMessage): Promise<string[]> {
  const facts: string[] = [];
  const phone = normalizePhone(inbound.phone);
  const digits = phone?.slice(-10);

  // Values go into a PostgREST filter string, so only pass ones that can't
  // carry filter syntax (commas, parentheses, quotes).
  const email = inbound.email && /^[^\s,()"']+@[^\s,()"']+$/.test(inbound.email) ? inbound.email : null;
  const contactId = inbound.contactId && /^[A-Za-z0-9_-]+$/.test(inbound.contactId) ? inbound.contactId : null;

  const filters: string[] = [];
  if (email) filters.push(`email.eq.${email}`);
  if (digits) filters.push(`phone.ilike.%${digits.slice(0, 3)}%${digits.slice(3, 6)}%${digits.slice(6)}%`);

  if (filters.length > 0) {
    const { data: customers } = await supabase
      .from("customers")
      .select("id, name, notes, properties(address, jobs(name, status, created_at))")
      .or(filters.join(","))
      .limit(3);
    for (const c of (customers ?? []) as unknown as {
      name: string;
      notes: string | null;
      properties: { address: string; jobs: { name: string; status: string; created_at: string }[] }[];
    }[]) {
      const jobs = c.properties.flatMap((p) => p.jobs.map((j) => `${j.name} at ${p.address} (${j.status})`));
      facts.push(
        `Customer record: ${c.name}${c.notes ? `. Notes: ${c.notes}` : ""}${jobs.length ? `. Jobs: ${jobs.join("; ")}` : ". No jobs yet."}`
      );
    }
  }

  const leadFilters = [...filters];
  if (contactId) leadFilters.push(`ghl_contact_id.eq.${contactId}`);
  if (leadFilters.length > 0) {
    const { data: leads } = await supabase
      .from("detailing_leads")
      .select("name, status, vehicle_size, monthly_price, add_ons, created_at")
      .or(leadFilters.join(","))
      .order("created_at", { ascending: false })
      .limit(2);
    for (const l of leads ?? []) {
      facts.push(
        `Apex Shine booking-funnel lead from ${l.created_at.slice(0, 10)}: ${l.name}, ${l.status === "membership_requested" ? "asked for a Complete Care membership" : "left contact info"}${l.vehicle_size ? `, vehicle: ${l.vehicle_size}` : ""}${l.monthly_price ? `, quoted $${l.monthly_price}/mo` : ""}${l.add_ons.length ? `, add-ons: ${l.add_ons.join(", ")}` : ""}.`
      );
    }
  }
  return facts;
}

async function loadHistory(supabase: Db, inbound: InboundMessage, member: TeamMember | null, excludeId: string) {
  let query = supabase
    .from("comm_messages")
    .select("id, direction, channel, body, created_at")
    .neq("id", excludeId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (member) query = query.eq("team_member_id", member.id);
  else if (inbound.contactId) query = query.eq("ghl_contact_id", inbound.contactId);
  else return [];
  const { data } = await query;
  return (data ?? []).reverse();
}

/**
 * Everything that happens when a message arrives on any channel:
 *  1. log it (skipping webhook retries),
 *  2. work out who sent it,
 *  3. for crew texts, record any check-in reply (existing flow),
 *  4. hand it to the agent, and record what the agent did.
 */
export async function handleInboundMessage(supabase: Db, inbound: InboundMessage) {
  const recorded = await recordInbound(supabase, inbound);
  if (!recorded) return { duplicate: true as const };

  const member = await findTeamMember(supabase, inbound);
  const senderKind: SenderKind = member ? (member.is_manager ? "manager" : "team") : "unknown";

  const senderFacts: string[] = [];
  if (member) {
    if (inbound.channel === "sms") {
      const checkIn = await handleInboundSms(supabase, inbound);
      if (checkIn.matched && checkIn.checkInId) {
        senderFacts.push(
          "This text was recorded as their reply to a scheduled check-in. If it reported a delay or blocker, managers were already texted, so don't escalate it again. Only reply if they asked something or need a response."
        );
      }
    }
  }
  const facts = member ? [] : await customerFacts(supabase, inbound);
  const finalKind: SenderKind = member ? senderKind : facts.length > 0 ? "customer" : "unknown";
  senderFacts.push(...facts);

  const { data: run, error: runError } = await supabase
    .from("agent_runs")
    .insert({
      sender_kind: finalKind,
      team_member_id: member?.id ?? null,
      ghl_contact_id: inbound.contactId,
      channel: inbound.channel,
    })
    .select("id")
    .single();
  if (runError) throw runError;

  await supabase
    .from("comm_messages")
    .update({ sender_kind: finalKind, team_member_id: member?.id ?? null, agent_run_id: run.id })
    .eq("id", recorded.id);

  if (!serverEnv.anthropicApiKey) {
    await finishRun(supabase, run.id, { status: "error", error: "ANTHROPIC_API_KEY is not set; message logged only." });
    return { runId: run.id, handled: false as const };
  }

  try {
    const history = await loadHistory(supabase, inbound, member, recorded.id);
    const result = await runCommsAgent({
      supabase,
      runId: run.id,
      inbound,
      senderKind: finalKind,
      member,
      senderFacts,
      history,
    });

    if (result.refused) {
      await notifyManagers(
        supabase,
        `Message the assistant wouldn't handle, from ${member?.name ?? inbound.name ?? inbound.phone ?? inbound.email ?? "unknown"} (${inbound.channel}): "${inbound.body.slice(0, 300)}"`,
        { excludeMemberId: member?.id, agentRunId: run.id }
      );
    }

    await finishRun(supabase, run.id, { status: "done", summary: result.summary, actions: result.actions });
    return { runId: run.id, handled: true as const, replied: result.replied };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[agent] run failed", error);
    await finishRun(supabase, run.id, { status: "error", error: message });
    // Never drop a message on the floor: a person gets it instead.
    await notifyManagers(
      supabase,
      `The assistant hit an error. Please handle this ${inbound.channel} from ${member?.name ?? inbound.name ?? inbound.phone ?? inbound.email ?? "unknown"}: "${inbound.body.slice(0, 300)}"`,
      { excludeMemberId: member?.id, agentRunId: run.id }
    ).catch(() => {});
    return { runId: run.id, handled: false as const };
  }
}

async function finishRun(
  supabase: Db,
  id: string,
  fields: { status: "done" | "error"; summary?: string; actions?: unknown; error?: string }
) {
  await supabase
    .from("agent_runs")
    .update({ ...fields, finished_at: new Date().toISOString() })
    .eq("id", id);
}
