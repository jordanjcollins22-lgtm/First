import type { SupabaseClient } from "@supabase/supabase-js";

import { log } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";

type Admin = SupabaseClient<Database>;

/** Who the thread says sent it: the app, on the business's behalf. */
export const APP_EMAIL_AUTHOR = "Email from the app";

/**
 * An email the app sent a client, put in that client's conversation, so
 * Conversations shows everything the client was told and not only what the
 * team typed there.
 *
 * Written only once the provider has taken it, so the thread never shows an
 * email that did not go. It lands on the job it was about; an email that
 * points at something else (a booking, a follow-up) lands on the client's
 * most recent job, and an email with neither has no thread to go in.
 *
 * Never throws: the email has gone, and failing to file a copy of it must
 * not turn a sent email into an error.
 */
export async function threadSentEmail(
  admin: Admin,
  input: {
    organizationId: string;
    jobId?: string | null;
    customerId?: string | null;
    subject: string;
    body: string;
    sentAt?: string;
  }
): Promise<void> {
  try {
    const jobId = await jobFor(admin, input.organizationId, input.jobId ?? null, input.customerId ?? null);
    if (!jobId) return;
    const { error } = await admin.from("job_messages").insert({
      job_id: jobId,
      organization_id: input.organizationId,
      channel: "external",
      author_type: "team",
      author_name: APP_EMAIL_AUTHOR,
      body: input.body,
      reference_label: input.subject.trim() || null,
      reference_kind: "email",
      sent_via: "email",
      ...(input.sentAt ? { created_at: input.sentAt } : {}),
    });
    if (error) throw error;
  } catch (err) {
    log.warn("email.thread_copy_failed", { jobId: input.jobId ?? null, error: err instanceof Error ? err.message : String(err) });
  }
}

/** The job a message about this client belongs on: the one named, else their most recent. */
export async function jobFor(admin: Admin, organizationId: string, jobId: string | null, customerId: string | null): Promise<string | null> {
  if (jobId) {
    const { data } = await admin
      .from("jobs")
      .select("id, property:properties!inner(customer:customers!inner(organization_id))")
      .eq("id", jobId)
      .eq("property.customer.organization_id", organizationId)
      .maybeSingle();
    if (data) return data.id;
  }
  if (!customerId) return null;
  const { data } = await admin
    .from("jobs")
    .select("id, property:properties!inner(customer_id)")
    .eq("property.customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data ?? []) as { id: string }[])[0]?.id ?? null;
}
