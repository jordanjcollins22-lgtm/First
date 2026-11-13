import type { SupabaseClient } from "@supabase/supabase-js";

import { ensureGhlContactId } from "@/lib/check-ins/service";
import { sendMessage } from "@/lib/ghl/client";
import type { Channel } from "@/lib/ghl/inbound";
import type { Database } from "@/lib/supabase/database.types";
import type { TeamMember } from "@/types/domain";

type Db = SupabaseClient<Database>;

/** Send on any channel through GHL and log it as an outbound message. */
export async function sendAndLog(
  supabase: Db,
  input: {
    contactId: string;
    channel: Channel | string;
    body: string;
    subject?: string | null;
    senderKind: string;
    teamMemberId?: string | null;
    contactName?: string | null;
    contactAddress?: string | null;
    agentRunId?: string | null;
  }
) {
  const result = await sendMessage({
    contactId: input.contactId,
    channel: input.channel,
    message: input.body,
    subject: input.subject,
  });
  await supabase.from("comm_messages").insert({
    channel: input.channel,
    direction: "outbound",
    sender_kind: input.senderKind,
    team_member_id: input.teamMemberId ?? null,
    ghl_contact_id: input.contactId,
    ghl_conversation_id: result.conversationId ?? null,
    ghl_message_id: result.messageId ?? null,
    contact_name: input.contactName ?? null,
    contact_address: input.contactAddress ?? null,
    subject: input.subject ?? null,
    body: input.body,
    agent_run_id: input.agentRunId ?? null,
  });
  return result;
}

/** Text a team member (employees are always reached by SMS). */
export async function textTeamMember(
  supabase: Db,
  member: TeamMember,
  body: string,
  agentRunId: string | null
) {
  const contactId = await ensureGhlContactId(supabase, member);
  return sendAndLog(supabase, {
    contactId,
    channel: "sms",
    body,
    senderKind: member.is_manager ? "manager" : "team",
    teamMemberId: member.id,
    contactName: member.name,
    contactAddress: member.phone,
    agentRunId,
  });
}

/** Text every active manager. Failures are logged, not thrown. */
export async function notifyManagers(
  supabase: Db,
  body: string,
  opts: { excludeMemberId?: string | null; agentRunId?: string | null } = {}
): Promise<number> {
  const { data, error } = await supabase
    .from("team_members")
    .select("*")
    .eq("active", true)
    .eq("is_manager", true);
  if (error) throw error;

  let sent = 0;
  for (const manager of (data ?? []) as unknown as TeamMember[]) {
    if (manager.id === opts.excludeMemberId) continue;
    try {
      await textTeamMember(supabase, manager, body, opts.agentRunId ?? null);
      sent++;
    } catch (err) {
      console.error(`[agent] failed to text manager ${manager.name}`, err);
    }
  }
  return sent;
}
