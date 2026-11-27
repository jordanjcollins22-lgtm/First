import { createAdminClient } from "@/lib/supabase/admin";
import { sendOutbound } from "@/lib/email/outbound";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { buildNewLeadEmail, type NewLeadDetails } from "@/lib/new-lead-email";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Tells the account manager the moment somebody books on /book.
 *
 * A booking used to save the client, the property and the Estimate job and
 * then tell nobody, so a lead could sit untouched for days until somebody
 * happened to open the clients list. This is an email because it is the one
 * channel that works today: there is no text line yet.
 *
 * Who hears: the client's own account manager when they already have one,
 * otherwise every account manager, otherwise the owners. Sent once per job,
 * so a retried booking doesn't send it twice. Never fails the booking.
 */
export async function alertNewLead(
  admin: Admin,
  input: Omit<NewLeadDetails, "referrer" | "clientUrl" | "managerFirstName"> & {
    organizationId: string;
    jobId: string;
    customerId: string;
    referralCode: string | null;
    referredByProfileId: string | null;
  }
): Promise<number> {
  const recipients = await whoHears(admin, input.organizationId, input.customerId);
  if (recipients.length === 0) {
    log.warn("lead.alert_nobody", { jobId: input.jobId });
    return 0;
  }

  const referrer = await describeReferrer(admin, input.organizationId, input.referralCode, input.referredByProfileId);
  const base = env.appUrl.replace(/\/$/, "") || "https://app.jslandscapingmd.com";
  const clientUrl = `${base}/clients/${input.customerId}`;

  let sent = 0;
  for (const person of recipients) {
    // Claimed before sending, so two overlapping runs can't both send it.
    const { error: claimError } = await admin
      .from("notification_log")
      .insert({ profile_id: person.id, kind: "new_lead", reference_id: input.jobId });
    if (claimError) continue;

    const mail = buildNewLeadEmail({
      ...input,
      referrer,
      clientUrl,
      managerFirstName: person.first_name || (person.full_name ?? "").split(" ")[0] || null,
    });
    const result = await sendOutbound({
      organizationId: input.organizationId,
      to: person.email,
      toName: person.full_name,
      subject: mail.subject,
      text: mail.text,
      fromName: "JS Landscaping app",
    });
    if (result.ok) {
      sent += 1;
    } else {
      // Let a later try send it, rather than leave a claim with no email behind it.
      await admin.from("notification_log").delete().eq("profile_id", person.id).eq("kind", "new_lead").eq("reference_id", input.jobId);
      log.warn("lead.alert_failed", { jobId: input.jobId, profileId: person.id, error: result.message });
    }
  }
  log.info("lead.alert_sent", { jobId: input.jobId, sent, recipients: recipients.length });
  return sent;
}

type Person = { id: string; email: string; first_name: string | null; full_name: string | null };

async function whoHears(admin: Admin, organizationId: string, customerId: string): Promise<Person[]> {
  const { data: customer } = await admin.from("customers").select("account_manager_id").eq("id", customerId).maybeSingle();
  const managerId = customer?.account_manager_id ?? null;
  if (managerId) {
    const { data } = await admin.from("profiles").select("id, email, first_name, full_name").eq("id", managerId).maybeSingle();
    if (data?.email) return [data as Person];
  }
  for (const role of [["account manager"], ["owner", "admin"]]) {
    const { data: roles } = await admin.from("profile_roles").select("profile_id").in("role_name", role);
    const ids = [...new Set((roles ?? []).map((r) => r.profile_id))];
    if (ids.length === 0) continue;
    const { data } = await admin
      .from("profiles")
      .select("id, email, first_name, full_name")
      .in("id", ids)
      .eq("organization_id", organizationId);
    const people = ((data ?? []) as Person[]).filter((p) => p.email);
    if (people.length > 0) return people;
  }
  return [];
}

/** Whose link it came through, in words: "Patricia's link (Facebook)". */
async function describeReferrer(
  admin: Admin,
  organizationId: string,
  referralCode: string | null,
  referredByProfileId: string | null
): Promise<string | null> {
  const parts: string[] = [];
  let linkOwnerId: string | null = null;
  if (referralCode) {
    const { data: link } = await admin
      .from("outreach_links")
      .select("profile_id, platform, sent_to")
      .eq("organization_id", organizationId)
      .eq("code", referralCode)
      .maybeSingle();
    if (link) {
      linkOwnerId = link.profile_id;
      const name = await personName(admin, link.profile_id);
      const where = [link.platform, link.sent_to ? `sent to ${link.sent_to}` : null].filter(Boolean).join(", ");
      parts.push(`${name ? `${name}'s` : "A tracked"} link${where ? ` (${where})` : ""}`);
    } else {
      parts.push(`Tracked link ${referralCode}`);
    }
  }
  if (referredByProfileId && referredByProfileId !== linkOwnerId) {
    const name = await personName(admin, referredByProfileId);
    if (name) parts.push(`referred by ${name}`);
  }
  return parts.length > 0 ? parts.join(", ") : null;
}

async function personName(admin: Admin, profileId: string): Promise<string | null> {
  const { data } = await admin.from("profiles").select("full_name, first_name").eq("id", profileId).maybeSingle();
  const name = (data?.full_name || data?.first_name || "").trim();
  return name ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}
