import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { isResendConfigured, isTwilioConfigured } from "@/lib/env";
import { mergeRules, type ReminderKind, type ReminderRule } from "@/lib/client-reminders";
import { QUIET_DEFAULTS } from "@/lib/quiet-hours";

/** Everything the reminders screen shows, in one read. */
export interface ReminderSettings {
  enabled: boolean;
  timeZone: string;
  quietStart: number;
  quietEnd: number;
  rules: ReminderRule[];
  /** Whether each channel could actually send anything today. */
  smsReady: boolean;
  emailReady: boolean;
  /** How many clients have told us to stop, so the number is never a surprise. */
  optedOut: { sms: number; email: number };
  /** What actually happened lately, because a switch with no evidence is a rumour. */
  recent: { sent: number; skipped: number; failed: number };
}

export async function getReminderSettings(): Promise<ReminderSettings> {
  const supabase = await createClient();
  const organization = await getCurrentOrganization();

  const [{ data: stored }, { data: consent }, { data: log }] = await Promise.all([
    supabase.from("reminder_rules").select("kind, enabled, channels, offsets_hours"),
    supabase.from("client_consent").select("channel, state").eq("state", "revoked"),
    supabase
      .from("client_message_log")
      .select("status")
      .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
  ]);

  const rules = mergeRules(
    (stored ?? []).map((row) => ({
      kind: row.kind as ReminderKind,
      enabled: row.enabled,
      channels: (row.channels ?? []) as ReminderRule["channels"],
      offsetsHours: row.offsets_hours ?? [],
    }))
  );

  const count = (status: string) => (log ?? []).filter((row) => row.status === status).length;

  return {
    enabled: Boolean(organization.client_reminders_enabled),
    timeZone: organization.reminder_time_zone ?? "America/New_York",
    quietStart: organization.reminder_quiet_start ?? QUIET_DEFAULTS.startHour,
    quietEnd: organization.reminder_quiet_end ?? QUIET_DEFAULTS.endHour,
    rules,
    smsReady: isTwilioConfigured,
    emailReady: isResendConfigured,
    optedOut: {
      sms: (consent ?? []).filter((row) => row.channel === "sms").length,
      email: (consent ?? []).filter((row) => row.channel === "email").length,
    },
    recent: { sent: count("sent"), skipped: count("skipped"), failed: count("failed") },
  };
}
