import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { toE164 } from "@/lib/sms";
import { defaultCallbackOn } from "@/lib/call-list";
import { contactsFor, quietWindowFor } from "@/lib/data/client-messaging";
import { loadSequenceSettings, untyped } from "@/lib/data/client-automations";
import { dayIn, sendMissedCallText } from "@/lib/data/client-automation-runs";
import { isLiveFor } from "@/lib/client-automations/settings";
import { automaticOutcome, isMissedDial, last10, missedCallKey, textableCaller, wasConversation } from "@/lib/client-automations/calls";

/**
 * What a call through the business number did, written down by itself.
 *
 * Called from the <Dial> action callback (webhooks/twilio-voice/dial-status)
 * once Twilio knows whether anybody answered, and from the inbound route when
 * there was nobody to ring at all. Two things follow from the record:
 *
 * - A missed call in gets the text-back within the minute, once per number
 *   per day, when that switch is on. A caller we have never heard of becomes
 *   a lead contact first, because every client message is sent to a contact
 *   and logged against one.
 * - A click-to-call out about a proposal that nobody picked up is logged on
 *   the proposal as "no answer" straight away, which is what the account
 *   manager would have tapped. One that connected waits for a one-tap
 *   disposition (hotspot 13).
 */

export interface DialResult {
  callSid: string;
  direction: "inbound" | "outbound";
  /** The client's number: the caller on the way in, the callee on the way out. */
  clientNumber: string;
  businessNumber: string | null;
  dialStatus: string;
  durationSeconds: number;
  /** Outbound: the job the Call button was pressed on. */
  jobId?: string | null;
  /** The team member on our end, when we know who. */
  profileId?: string | null;
  origin: string;
}

type Admin = ReturnType<typeof createAdminClient>;

/** The business a number belongs to: by its own phone, else the first one made (single-business install). */
async function organizationFor(admin: Admin, businessNumber: string | null, jobId: string | null | undefined): Promise<{ id: string; name: string; reminder_time_zone: string; reminder_quiet_start: number; reminder_quiet_end: number; client_reminders_enabled: boolean } | null> {
  const cols = "id, name, business_phone, reminder_time_zone, reminder_quiet_start, reminder_quiet_end, client_reminders_enabled, created_at";
  if (jobId) {
    const { data } = await admin.from("jobs").select("property:properties!inner(customer:customers!inner(organization_id))").eq("id", jobId).maybeSingle();
    const orgId = (data as unknown as { property: { customer: { organization_id: string } } } | null)?.property?.customer?.organization_id;
    if (orgId) {
      const { data: org } = await admin.from("organizations").select(cols).eq("id", orgId).maybeSingle();
      if (org) return org;
    }
  }
  const { data: orgs } = await admin.from("organizations").select(cols).order("created_at", { ascending: true }).limit(20);
  const list = orgs ?? [];
  const mine = businessNumber ? list.find((o) => o.business_phone && last10(o.business_phone) === last10(businessNumber)) : null;
  return mine ?? list[0] ?? null;
}

export async function recordDialResult(input: DialResult): Promise<{ missed: boolean }> {
  const admin = createAdminClient();
  const sb = untyped(admin);
  const missed = input.direction === "inbound" ? isMissedDial(input.dialStatus) : !wasConversation(input.dialStatus, input.durationSeconds);

  const org = await organizationFor(admin, input.businessNumber, input.jobId);
  if (!org) return { missed };
  const settings = await loadSequenceSettings(admin, org.id);

  // Who it was: the job's client on the way out, the number's owner on the way in.
  let customerId: string | null = null;
  let jobId = input.jobId ?? null;
  if (jobId) {
    const { data } = await admin.from("jobs").select("property:properties!inner(customer_id)").eq("id", jobId).maybeSingle();
    customerId = (data as unknown as { property: { customer_id: string | null } } | null)?.property?.customer_id ?? null;
  }
  if (!customerId && input.clientNumber) {
    const digits = last10(input.clientNumber);
    const { data: candidates } = await admin
      .from("customers")
      .select("id, phone")
      .eq("organization_id", org.id)
      .ilike("phone", `%${digits.slice(-4)}%`)
      .limit(200);
    customerId = (candidates ?? []).find((c) => c.phone && last10(c.phone) === digits)?.id ?? null;
  }

  // The proposal it is about: their latest one still out, or declined lately
  // (the call list rings both).
  let proposalId: string | null = null;
  if (customerId) {
    const { data: proposals } = await admin
      .from("job_proposals")
      .select("id, job_id, status, updated_at, job:jobs!inner(property:properties!inner(customer_id))")
      .eq("organization_id", org.id)
      .in("status", ["sent", "declined"])
      .eq("job.property.customer_id", customerId)
      .gte("updated_at", new Date(Date.now() - 120 * 86_400_000).toISOString())
      .order("updated_at", { ascending: false })
      .limit(1);
    const p = (proposals ?? [])[0] as unknown as { id: string; job_id: string } | undefined;
    if (p) {
      proposalId = p.id;
      jobId = jobId ?? p.job_id;
    }
  }

  const logging = settings.call_logging;
  const textBack = settings.missed_call_text;
  const now = new Date();

  // A missed call from somebody new is a lead: a contact to text and log against.
  const wantsText = input.direction === "inbound" && missed && textBack.enabled && isLiveFor(textBack, now) && org.client_reminders_enabled && textableCaller(input.clientNumber);
  if (!customerId && wantsText) {
    const phone = toE164(input.clientNumber) ?? input.clientNumber;
    const { data: made } = await admin
      .from("customers")
      .insert({ organization_id: org.id, name: `Caller ${phone}`, phone, contact_type: "lead", source: "missed_call" })
      .select("id")
      .maybeSingle();
    customerId = made?.id ?? null;
  }

  if (logging.enabled || wantsText) {
    const { data: row, error } = await sb
      .from("voice_calls")
      .upsert(
        {
          organization_id: org.id,
          call_sid: input.callSid,
          direction: input.direction,
          from_number: input.direction === "inbound" ? input.clientNumber : input.businessNumber,
          to_number: input.direction === "inbound" ? input.businessNumber : input.clientNumber,
          customer_id: customerId,
          job_id: jobId,
          proposal_id: proposalId,
          profile_id: input.profileId ?? null,
          dial_status: input.dialStatus || "unknown",
          duration_seconds: Math.max(0, Math.round(input.durationSeconds || 0)),
          missed,
        },
        { onConflict: "call_sid", ignoreDuplicates: true }
      )
      .select("id")
      .maybeSingle();
    if (error) log.warn("voice_calls.record_failed", { error: error.message });
    const callId = (row as { id: string } | null)?.id ?? null;

    // Outbound to a proposal client that never connected: "no answer", logged.
    if (callId && logging.enabled && isLiveFor(logging, now) && proposalId && jobId) {
      const outcome = automaticOutcome(input.direction, input.dialStatus, input.durationSeconds);
      if (outcome === "no_answer") {
        const { data: call } = await admin
          .from("proposal_calls")
          .insert({
            organization_id: org.id,
            proposal_id: proposalId,
            job_id: jobId,
            customer_id: customerId,
            profile_id: input.profileId ?? null,
            outcome: "no_answer",
            note: `Logged from the phone line: ${input.dialStatus || "no answer"}.`,
            callback_on: defaultCallbackOn("no_answer", now),
          })
          .select("id")
          .maybeSingle();
        if (call?.id) {
          await sb.from("voice_calls").update({ disposition: "no_answer", disposition_at: now.toISOString(), proposal_call_id: call.id }).eq("id", callId);
        }
      }
    }

    // The text-back, now, inside the client-message rules.
    if (wantsText && customerId && callId) {
      const contact = (await contactsFor([customerId])).get(customerId);
      if (contact) {
        const window = quietWindowFor(org);
        const key = missedCallKey(input.clientNumber, dayIn(now, window.timeZone));
        await sendMissedCallText({ org: { id: org.id, name: org.name }, window, origin: input.origin, now }, contact, callId, key).catch((err) =>
          log.warn("missed_call_text.failed", { error: err instanceof Error ? err.message : String(err) })
        );
      }
    }
  }
  return { missed };
}
