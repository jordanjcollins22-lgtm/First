import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { findCompanies, findEmails } from "@/lib/data/pm-finder";
import { writeSequences } from "@/lib/data/pm-writer";
import { sendDue } from "@/lib/data/pm-sender";

type Admin = ReturnType<typeof createAdminClient>;

export interface PmRun {
  found: number;
  emailsFound: number;
  written: number;
  sent: number;
  blocked: string | null;
}

/**
 * One pass of the property manager pipeline for one business: look for new
 * companies (weekly), read a few websites for an email, write a few
 * sequences, and send whatever is due. Each step is small, so a pass fits
 * in one call and the next pass picks up where this one stopped.
 */
export async function runPmOutreach(admin: Admin, organizationId: string, baseUrl: string, now = new Date()): Promise<PmRun> {
  const [{ data: settings }, { data: org }] = await Promise.all([
    admin.from("pm_outreach_settings").select("*").eq("organization_id", organizationId).maybeSingle(),
    admin.from("organizations").select("name, business_phone, business_address").eq("id", organizationId).maybeSingle(),
  ]);
  if (!settings || !org) return { found: 0, emailsFound: 0, written: 0, sent: 0, blocked: "Not set up." };

  const step = async <T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      log.error(`pm.${name}_failed`, err, { organizationId });
      return fallback;
    }
  };

  const found = await step("find", () => findCompanies(admin, organizationId, settings.towns ?? [], settings.last_search_at, now), 0);
  const emailsFound = await step("emails", () => findEmails(admin, organizationId), 0);
  const written = await step(
    "write",
    () =>
      writeSequences(
        admin,
        organizationId,
        { story: settings.story, offer: settings.offer, fromName: settings.from_name, autoApprove: settings.auto_approve },
        { name: org.name, phone: org.business_phone },
        now
      ),
    0
  );
  const sending = await step(
    "send",
    () =>
      sendDue(
        admin,
        {
          organizationId,
          businessName: org.name,
          address: org.business_address,
          fromName: settings.from_name || org.name,
          sendingOn: settings.sending_on,
          dailyCap: settings.daily_cap,
          baseUrl,
        },
        now
      ),
    { sent: 0, blocked: "Sending failed. See the log." }
  );
  return { found, emailsFound, written, sent: sending.sent, blocked: sending.blocked };
}
