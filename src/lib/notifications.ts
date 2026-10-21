import { createAdminClient } from "@/lib/supabase/admin";
import { isSmsConfigured } from "@/lib/env";
import { sendSms, toE164 } from "@/lib/sms";
import { effectivePrefs, label, notificationGate, type NotificationKind as GateKind } from "@/lib/notification-gate";
import { sendEmail } from "@/lib/email/send";
import { textToHtml } from "@/lib/email/plain";
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
    /** Who it is about, for the subject line when it goes as an email. */
    about?: string | null;
  }
): Promise<boolean> {
  const admin = createAdminClient();

  const [{ data: prefs }, { data: profile }] = await Promise.all([
    admin.from("notification_preferences").select("*").eq("profile_id", profileId).maybeSingle(),
    admin.from("profiles").select("phone").eq("id", profileId).maybeSingle(),
  ]);

  // One decision, with a reason attached. Every skip used to be a bare
  // `return false` -- indistinguishable from a send, from the outside and
  // from the logs, which is why "nobody got notified" had no answer.
  const verdict = notificationGate({
    smsConfigured: isSmsConfigured,
    prefs,
    hasStoredPrefs: Boolean(prefs),
    phone: profile?.phone,
    toE164,
    kind: kind as GateKind,
    overridesKind: options?.overridesKindPreference,
  });

  if (!verdict.send) {
    // A text that cannot go because there is no text line, or no number,
    // goes as an email instead. Every crew alert, client message and
    // proposal response used to vanish here until Twilio existed.
    if (verdict.reason === "no_sms_provider" || verdict.reason === "no_phone" || verdict.reason === "unreadable_phone") {
      const emailed = await emailInstead(profileId, kind, body, options).catch(() => false);
      if (emailed) return true;
    }
    // Said out loud rather than swallowed. It is the only trace of a
    // notification that was never sent.
    console.warn(`Notification skipped (${kind}, profile ${profileId}): ${verdict.detail}`);
    return false;
  }

  const e164 = toE164((profile?.phone ?? "").trim())!;

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

/**
 * The same alert, to their inbox.
 *
 * Their own switches still apply: notifications off is off, and a kind they
 * turned off stays off. Only the channel changes, because "there is no way
 * to text you" is not a reason for them to hear nothing.
 */
async function emailInstead(
  profileId: string,
  kind: NotificationKind,
  body: string,
  options?: { dedupeKey?: string; overridesKindPreference?: boolean; about?: string | null }
): Promise<boolean> {
  const admin = createAdminClient();
  const [{ data: prefsRow }, { data: profile }] = await Promise.all([
    admin.from("notification_preferences").select("*").eq("profile_id", profileId).maybeSingle(),
    admin.from("profiles").select("email, organization_id").eq("id", profileId).maybeSingle(),
  ]);
  const prefs = effectivePrefs(prefsRow);
  if (!prefs.sms_enabled) return false;
  if (!prefs[kind as GateKind] && !options?.overridesKindPreference) return false;
  const to = profile?.email?.trim();
  if (!to || !profile?.organization_id) return false;

  if (options?.dedupeKey) {
    const { error } = await admin
      .from("notification_log")
      .insert({ profile_id: profileId, kind, reference_id: options.dedupeKey });
    if (error) return false;
  }

  const sent = await sendEmail({
    organizationId: profile.organization_id,
    to,
    subject: options?.about ? `${label(kind as GateKind)}: ${options.about}` : label(kind as GateKind),
    html: textToHtml(body),
    text: body,
    stream: "transactional",
  });
  return sent.ok;
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
  if (profileIds.length === 0) return;
  const who = await jobWho(jobId).catch(() => null);
  const text = withJobContext(body, who);
  await Promise.all(
    profileIds.map((id) => notifyTeamMember(id, kind, text, { ...options, about: who?.name ?? null }).catch(() => false))
  );
}

/** The client, the street and the job number a job alert is about. */
export interface JobWho {
  name: string | null;
  address: string | null;
  jobNumber: number | null;
}

async function jobWho(jobId: string): Promise<JobWho | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("jobs")
    .select("job_number, property:properties(address, customer:customers(name))")
    .eq("id", jobId)
    .maybeSingle();
  if (!data) return null;
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
  const property = one((data as { property?: unknown }).property as { address: string | null; customer: unknown } | null);
  const customer = one(property?.customer as { name: string | null } | null);
  return {
    name: customer?.name?.trim() || null,
    address: property?.address?.trim() || null,
    jobNumber: (data as { job_number?: number | null }).job_number ?? null,
  };
}

/**
 * The alert with who it is about. "A client accepted their proposal" told
 * the office something happened and not to whom, so every one of them meant
 * opening the app to find out. The client's name goes where "A client" was,
 * or in front when the message names nobody, and the street and job number
 * follow on a line of their own.
 */
export function withJobContext(body: string, who: JobWho | null): string {
  if (!who) return body;
  let text = body;
  if (who.name) {
    if (/^A client\b/.test(text)) text = text.replace(/^A client\b/, who.name);
    else if (!text.includes(who.name)) text = `${who.name}: ${text}`;
  }
  const street = who.address ? who.address.split(",").slice(0, 2).join(",").trim() : null;
  const where = [street, who.jobNumber != null ? `Job #${who.jobNumber}` : null].filter(Boolean).join(" · ");
  return where ? `${text}\n${where}` : text;
}
