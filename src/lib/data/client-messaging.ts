import { createAdminClient } from "@/lib/supabase/admin";
import { isResendConfigured, isTwilioConfigured } from "@/lib/env";
import { sendSms, toE164 } from "@/lib/sms";
import { sendEmail } from "@/lib/email/send";
import {
  consentVerdict,
  type Channel,
  type ConsentState,
  type SendBasis,
} from "@/lib/client-consent";
import { isQuiet, QUIET_DEFAULTS, type QuietWindow } from "@/lib/quiet-hours";

/**
 * The one door every automated message to a client goes through.
 *
 * It checks, it sends, and it writes down what happened either way. Nothing
 * else in the app should call Twilio or Resend for a client, because every
 * one of those call sites would be a place the consent rules are not applied
 * and a send nobody can account for afterwards.
 *
 * Runs as the service role: the caller is a cron with nobody signed in.
 */

export interface ClientMessage {
  organizationId: string;
  customerId: string;
  channel: Channel;
  basis: SendBasis;
  /** What this is, for the log: a reminder kind, or anything else. */
  kind: string;
  /** The job, proposal or invoice it is about. */
  referenceId?: string | null;
  /** What makes this send unique. Sending twice under one key is impossible. */
  dedupeKey: string;
  subject: string;
  body: string;
}

export type SendOutcome =
  | { sent: true; providerId: string | null }
  | { sent: false; reason: string; detail: string };

/** Everything about a client that deciding whether to write to them needs. */
export interface ClientContact {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  doNotContact: boolean;
  smsConsent: ConsentState;
  emailConsent: ConsentState;
  /** Whether we have ever texted this number. The opt-out line goes on the first. */
  textedBefore: boolean;
  unsubscribeToken: string | null;
}

/**
 * The clients on a list, with what each has agreed to.
 *
 * Read in one go rather than per message: a run reminding forty people should
 * be a handful of queries, not a hundred and twenty.
 */
export async function contactsFor(customerIds: string[]): Promise<Map<string, ClientContact>> {
  const admin = createAdminClient();
  const ids = [...new Set(customerIds)].filter(Boolean);
  if (ids.length === 0) return new Map();

  const [{ data: customers }, { data: consent }, { data: texted }] = await Promise.all([
    admin
      .from("customers")
      .select("id, name, email, phone, do_not_contact, unsubscribe_token")
      .in("id", ids),
    admin.from("client_consent").select("customer_id, channel, state").in("customer_id", ids),
    admin
      .from("client_message_log")
      .select("customer_id")
      .eq("channel", "sms")
      .eq("status", "sent")
      .in("customer_id", ids),
  ]);

  const stateOf = new Map<string, ConsentState>();
  for (const row of consent ?? []) {
    stateOf.set(`${row.customer_id}:${row.channel}`, (row.state as ConsentState) ?? "unknown");
  }
  const everTexted = new Set((texted ?? []).map((row) => row.customer_id));

  return new Map(
    (customers ?? []).map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        doNotContact: Boolean(row.do_not_contact),
        smsConsent: stateOf.get(`${row.id}:sms`) ?? "unknown",
        emailConsent: stateOf.get(`${row.id}:email`) ?? "unknown",
        textedBefore: everTexted.has(row.id),
        unsubscribeToken: row.unsubscribe_token,
      },
    ])
  );
}

/** The keys already used, so nothing is sent twice. */
export async function alreadySent(organizationId: string, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const admin = createAdminClient();
  const { data } = await admin
    .from("client_message_log")
    .select("dedupe_key")
    .eq("organization_id", organizationId)
    .in("dedupe_key", keys);
  return new Set((data ?? []).map((row) => row.dedupe_key));
}

/** The hours this business may write to a client in. */
export function quietWindowFor(org: {
  reminder_quiet_start?: number | null;
  reminder_quiet_end?: number | null;
  reminder_time_zone?: string | null;
}): QuietWindow {
  return {
    startHour: org.reminder_quiet_start ?? QUIET_DEFAULTS.startHour,
    endHour: org.reminder_quiet_end ?? QUIET_DEFAULTS.endHour,
    timeZone: org.reminder_time_zone ?? "America/New_York",
  };
}

/**
 * Send one message to one client, or write down why not.
 *
 * The log entry is written before the provider is called, under a unique key,
 * so two runs at once cannot both get past it. If the send then fails, the
 * row is marked failed rather than deleted: a thing that was attempted and
 * did not work is worth more in a log than a gap.
 */
export async function sendClientMessage(
  message: ClientMessage,
  contact: ClientContact,
  window: QuietWindow,
  now = new Date()
): Promise<SendOutcome> {
  const admin = createAdminClient();

  const address = message.channel === "sms" ? contact.phone : contact.email;
  const verdict = consentVerdict({
    basis: message.basis,
    channel: message.channel,
    state: message.channel === "sms" ? contact.smsConsent : contact.emailConsent,
    doNotContact: contact.doNotContact,
    providerReady: message.channel === "sms" ? isTwilioConfigured : isResendConfigured,
    address,
  });

  const record = async (
    status: "sent" | "skipped" | "failed",
    extra: { skipReason?: string; detail?: string; providerId?: string | null }
  ) => {
    await admin.from("client_message_log").upsert(
      {
        organization_id: message.organizationId,
        customer_id: message.customerId,
        channel: message.channel,
        kind: message.kind,
        reference_id: message.referenceId ?? null,
        dedupe_key: message.dedupeKey,
        status,
        skip_reason: extra.skipReason ?? null,
        detail: extra.detail ?? null,
        provider_id: extra.providerId ?? null,
        body: message.body,
      },
      { onConflict: "organization_id,dedupe_key" }
    );
  };

  if (!verdict.send) {
    await record("skipped", { skipReason: verdict.reason, detail: verdict.detail });
    return { sent: false, reason: verdict.reason, detail: verdict.detail };
  }

  // Held rather than dropped. The cron runs again and this comes back round
  // once the window is open, which is what a person means by "the evening
  // before" when the job was scheduled at midnight.
  if (isQuiet(now, window)) {
    return { sent: false, reason: "quiet_hours", detail: "Held until the morning." };
  }

  // Claimed before it is sent, so two runs at once cannot both pass here.
  const claim = await admin.from("client_message_log").insert({
    organization_id: message.organizationId,
    customer_id: message.customerId,
    channel: message.channel,
    kind: message.kind,
    reference_id: message.referenceId ?? null,
    dedupe_key: message.dedupeKey,
    status: "sent",
    body: message.body,
  });
  if (claim.error) {
    // The unique key did its job: somebody else has this one.
    return { sent: false, reason: "already_sent", detail: "Already sent." };
  }

  try {
    if (message.channel === "sms") {
      const number = toE164(contact.phone ?? "");
      if (!number) throw new Error("Unreadable phone number.");
      await sendSms(number, message.body);
      return { sent: true, providerId: null };
    }

    const result = await sendEmail({
      organizationId: message.organizationId,
      to: contact.email ?? "",
      subject: message.subject,
      html: htmlFor(message.body),
      text: message.body,
      stream: "transactional",
    });
    if (!result.ok) throw new Error(result.message);
    await record("sent", { providerId: result.id });
    return { sent: true, providerId: result.id };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "The provider refused it.";
    await record("failed", { detail });
    return { sent: false, reason: "failed", detail };
  }
}

/** The plain text as an email body. Deliberately plain: this is not a campaign. */
function htmlFor(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<div style="font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#111">${escaped
    .split("\n\n")
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("")}</div>`;
}

/**
 * Write down what somebody said about being contacted.
 *
 * Always with its evidence. "They replied STOP on 3 March" is the sentence
 * that answers the only question anybody ever asks about this.
 */
export async function recordConsent(input: {
  organizationId: string;
  customerId: string;
  channel: Channel;
  state: ConsentState;
  source: string;
  evidence?: string | null;
  changedBy?: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  await admin.from("client_consent").upsert(
    {
      organization_id: input.organizationId,
      customer_id: input.customerId,
      channel: input.channel,
      state: input.state,
      source: input.source,
      evidence: input.evidence ?? null,
      changed_at: new Date().toISOString(),
      changed_by: input.changedBy ?? null,
    },
    { onConflict: "customer_id,channel" }
  );
}
