import type { SupabaseClient } from "@supabase/supabase-js";

import { sendSms, upsertTeamMemberContact } from "@/lib/ghl/client";
import type { InboundSms } from "@/lib/ghl/inbound";
import type { Database } from "@/lib/supabase/database.types";
import type { CheckIn, CheckInSchedule, TeamMember } from "@/types/domain";

import { assessReply } from "./assess-reply";
import { normalizePhone } from "./phone";
import { dueOccurrences, renderCheckInMessage } from "./schedule";

type Db = SupabaseClient<Database>;

/** How far back each cron run looks for occurrences it hasn't sent yet. */
const CRON_LOOKBACK_MINUTES = 20;
/** Replies are matched to the newest open check-in sent within this window. */
const REPLY_MATCH_WINDOW_HOURS = 18;

export async function ensureGhlContactId(supabase: Db, member: TeamMember): Promise<string> {
  if (member.ghl_contact_id) return member.ghl_contact_id;
  const contactId = await upsertTeamMemberContact({ name: member.name, phone: member.phone });
  const { error } = await supabase
    .from("team_members")
    .update({ ghl_contact_id: contactId })
    .eq("id", member.id);
  if (error) throw error;
  member.ghl_contact_id = contactId;
  return contactId;
}

async function sendTextToMember(
  supabase: Db,
  member: TeamMember,
  body: string,
  checkInId: string | null
) {
  const contactId = await ensureGhlContactId(supabase, member);
  const result = await sendSms({ contactId, message: body });
  await supabase.from("sms_messages").insert({
    team_member_id: member.id,
    check_in_id: checkInId,
    direction: "outbound",
    phone: member.phone,
    body,
    ghl_contact_id: contactId,
    ghl_message_id: result.messageId ?? null,
  });
}

/** Send a check-in row that's already in the DB and record the outcome on it. */
export async function deliverCheckIn(supabase: Db, checkIn: CheckIn, member: TeamMember) {
  try {
    await sendTextToMember(supabase, member, checkIn.message, checkIn.id);
    const { error } = await supabase
      .from("check_ins")
      .update({ status: "sent", sent_at: new Date().toISOString(), error: null })
      .eq("id", checkIn.id);
    if (error) throw error;
    return { ok: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("check_ins").update({ status: "failed", error: message }).eq("id", checkIn.id);
    return { ok: false as const, error: message };
  }
}

/** Create and send a one-off check-in right now (the "Send check-in now" button). */
export async function sendImmediateCheckIn(
  supabase: Db,
  member: TeamMember,
  message: string,
  responseWindowMinutes = 30
) {
  const now = new Date();
  const { data, error } = await supabase
    .from("check_ins")
    .insert({
      team_member_id: member.id,
      scheduled_for: now.toISOString(),
      due_by: new Date(now.getTime() + responseWindowMinutes * 60_000).toISOString(),
      message: renderCheckInMessage(message, { name: member.name }),
    })
    .select()
    .single();
  if (error) throw error;
  return deliverCheckIn(supabase, data as unknown as CheckIn, member);
}

type ScheduleWithRelations = CheckInSchedule & {
  team_member: TeamMember | null;
  job: { id: string; name: string } | null;
};

/** Cron step 1: create + send every scheduled check-in that has come due. */
export async function sendDueCheckIns(supabase: Db, now = new Date()) {
  const { data, error } = await supabase
    .from("check_in_schedules")
    .select("*, team_member:team_members(*), job:jobs(id, name)")
    .eq("active", true);
  if (error) throw error;

  const schedules = (data ?? []) as unknown as ScheduleWithRelations[];
  let sent = 0;
  const failures: string[] = [];

  for (const schedule of schedules) {
    const member = schedule.team_member;
    if (!member?.active) continue;

    for (const at of dueOccurrences(schedule, member.timezone, now, CRON_LOOKBACK_MINUTES)) {
      // The unique (schedule_id, scheduled_for) key makes this idempotent:
      // if another run already claimed this occurrence, nothing comes back.
      const { data: inserted, error: insertError } = await supabase
        .from("check_ins")
        .upsert(
          {
            team_member_id: member.id,
            schedule_id: schedule.id,
            job_id: schedule.job_id,
            scheduled_for: at.toISOString(),
            due_by: new Date(at.getTime() + schedule.response_window_minutes * 60_000).toISOString(),
            message: renderCheckInMessage(schedule.message, {
              name: member.name,
              job: schedule.job?.name,
            }),
          },
          { onConflict: "schedule_id,scheduled_for", ignoreDuplicates: true }
        )
        .select();
      if (insertError) throw insertError;
      const checkIn = inserted?.[0] as unknown as CheckIn | undefined;
      if (!checkIn) continue;

      const result = await deliverCheckIn(supabase, checkIn, member);
      if (result.ok) sent++;
      else failures.push(`${member.name}: ${result.error}`);
    }
  }

  return { sent, failures };
}

async function notifyManagers(supabase: Db, text: string, excludeMemberId?: string) {
  const { data, error } = await supabase
    .from("team_members")
    .select("*")
    .eq("active", true)
    .eq("is_manager", true);
  if (error) throw error;

  for (const manager of (data ?? []) as unknown as TeamMember[]) {
    if (manager.id === excludeMemberId) continue;
    try {
      await sendTextToMember(supabase, manager, text, null);
    } catch (err) {
      console.error(`[check-ins] failed to alert manager ${manager.name}`, err);
    }
  }
}

/** Cron step 2: anything still unanswered past its window becomes "missed". */
export async function flagMissedCheckIns(supabase: Db, now = new Date()) {
  const { data, error } = await supabase
    .from("check_ins")
    .update({ status: "missed", escalated_at: now.toISOString() })
    .eq("status", "sent")
    .lt("due_by", now.toISOString())
    .select("*, team_member:team_members(name)");
  if (error) throw error;

  const missed = (data ?? []) as unknown as (CheckIn & { team_member: { name: string } | null })[];
  for (const checkIn of missed) {
    await notifyManagers(
      supabase,
      `Missed check-in: ${checkIn.team_member?.name ?? "A team member"} hasn't replied to "${checkIn.message}"`,
      checkIn.team_member_id
    );
  }
  return { missed: missed.length };
}

/**
 * Handle a text a team member sent back. Identifies them by GHL contact id or
 * phone number, attaches the reply to their most recent open check-in, and has
 * Claude flag delays/blockers to managers.
 */
export async function handleInboundSms(supabase: Db, inbound: InboundSms) {
  const member = await findTeamMember(supabase, inbound);
  if (!member) return { matched: false as const };

  const now = new Date();
  const since = new Date(now.getTime() - REPLY_MATCH_WINDOW_HOURS * 3_600_000).toISOString();
  const { data: open, error } = await supabase
    .from("check_ins")
    .select("*, job:jobs(name)")
    .eq("team_member_id", member.id)
    .in("status", ["sent", "missed"])
    .gte("sent_at", since)
    .order("sent_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const checkIn = open?.[0] as unknown as (CheckIn & { job: { name: string } | null }) | undefined;

  await supabase.from("sms_messages").insert({
    team_member_id: member.id,
    check_in_id: checkIn?.id ?? null,
    direction: "inbound",
    phone: member.phone,
    body: inbound.body,
    ghl_contact_id: inbound.contactId,
    ghl_message_id: inbound.messageId,
  });

  if (!checkIn) return { matched: true as const, memberId: member.id, checkInId: null };

  const onTime = now.getTime() <= new Date(checkIn.due_by).getTime();
  const assessment = await assessReply({
    checkInMessage: checkIn.message,
    reply: inbound.body,
    memberName: member.name,
    jobName: checkIn.job?.name,
  });

  const { error: updateError } = await supabase
    .from("check_ins")
    .update({
      status: onTime ? "responded" : "late",
      responded_at: now.toISOString(),
      response_text: inbound.body,
      reply_assessment: assessment?.assessment ?? null,
      reply_summary: assessment?.summary ?? null,
    })
    .eq("id", checkIn.id);
  if (updateError) throw updateError;

  if (assessment && (assessment.assessment === "delayed" || assessment.assessment === "blocked")) {
    const label = assessment.assessment === "blocked" ? "BLOCKED" : "Running behind";
    await notifyManagers(supabase, `${label} - ${member.name}: ${assessment.summary}`, member.id);
  }

  return { matched: true as const, memberId: member.id, checkInId: checkIn.id };
}

async function findTeamMember(supabase: Db, inbound: InboundSms): Promise<TeamMember | null> {
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
  const { data } = await supabase
    .from("team_members")
    .select("*")
    .eq("phone", phone)
    .eq("active", true)
    .maybeSingle();
  const member = (data as unknown as TeamMember | null) ?? null;

  // Learn the contact id so future matches don't depend on the phone field.
  if (member && inbound.contactId && !member.ghl_contact_id) {
    await supabase.from("team_members").update({ ghl_contact_id: inbound.contactId }).eq("id", member.id);
  }
  return member;
}
