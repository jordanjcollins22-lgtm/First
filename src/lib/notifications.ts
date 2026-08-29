import { createAdminClient } from "@/lib/supabase/admin";
import { isTwilioConfigured } from "@/lib/env";
import { sendSms, toE164 } from "@/lib/sms";
import type { NotificationKind } from "@/types/domain";

/**
 * Texts a team member, but only if they've turned notifications on and
 * opted into this kind. Best-effort throughout: a notification is a bonus on
 * top of whatever just happened in the app, never a reason to fail it, so
 * callers should fire-and-forget with a .catch().
 *
 * Uses the admin client because it reads another person's preferences and
 * phone number — the signed-in user's RLS scope only covers their own row,
 * and the trigger is usually someone else's action (or a cron with no user
 * at all).
 */
export async function notifyTeamMember(
  profileId: string,
  kind: NotificationKind,
  body: string,
  options?: {
    dedupeKey?: string;
    /** The person opted into this specific thing (e.g. one group), so the
     * general per-kind toggle shouldn't veto it. The master switch and a
     * usable phone number still apply. */
    overridesKindPreference?: boolean;
  }
): Promise<boolean> {
  if (!isTwilioConfigured) return false;

  const admin = createAdminClient();

  const { data: prefs } = await admin
    .from("notification_preferences")
    .select("*")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (!prefs?.sms_enabled) return false;
  if (!prefs[kind] && !options?.overridesKindPreference) return false;

  const { data: profile } = await admin.from("profiles").select("phone").eq("id", profileId).maybeSingle();
  const e164 = profile?.phone ? toE164(profile.phone) : null;
  if (!e164) return false;

  // Claim the send before making it, so a retried or overlapping run can't
  // text the same person about the same thing twice.
  if (options?.dedupeKey) {
    const { error } = await admin
      .from("notification_log")
      .insert({ profile_id: profileId, kind, reference_id: options.dedupeKey });
    if (error) return false;
  }

  await sendSms(e164, body);
  return true;
}

/** Who on the team should hear about this job: whoever it's assigned to,
 * plus the customer's account manager. Deduped, since they're often the
 * same person. */
export async function teamMembersForJob(jobId: string): Promise<string[]> {
  const admin = createAdminClient();

  const { data: job } = await admin.from("jobs").select("assigned_to, property_id").eq("id", jobId).maybeSingle();
  if (!job) return [];

  const ids = new Set<string>();
  // The whole crew, not just the lead — a message about a job should reach
  // everybody working it. assigned_to is kept as a fallback for jobs that
  // predate the roster table.
  if (job.assigned_to) ids.add(job.assigned_to);
  const { data: crew } = await admin.from("job_crew").select("profile_id").eq("job_id", jobId);
  for (const member of (crew ?? []) as { profile_id: string }[]) ids.add(member.profile_id);

  const { data: property } = await admin
    .from("properties")
    .select("customer_id")
    .eq("id", job.property_id)
    .maybeSingle();
  if (property) {
    const { data: customer } = await admin
      .from("customers")
      .select("account_manager_id")
      .eq("id", property.customer_id)
      .maybeSingle();
    if (customer?.account_manager_id) ids.add(customer.account_manager_id);
  }

  return Array.from(ids);
}

/** Fire-and-forget fan-out for a job event.
 *
 * `except` drops one person from the list — whoever caused the event. Texting
 * somebody their own message is the fastest way to get notifications turned
 * off entirely. */
export async function notifyJobTeam(
  jobId: string,
  kind: NotificationKind,
  body: string,
  options?: { dedupeKey?: string; except?: string | null }
): Promise<void> {
  const profileIds = (await teamMembersForJob(jobId)).filter((id) => id !== options?.except);
  await Promise.all(
    profileIds.map((id) => notifyTeamMember(id, kind, body, options).catch(() => false))
  );
}
