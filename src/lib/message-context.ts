import { createAdminClient } from "@/lib/supabase/admin";
import { outboundBaseUrl } from "@/lib/base-url";
import { absolute, proposalPath } from "@/lib/proposal-flow";

export interface JobThreadContext {
  /** The name the client knows us by, for the front of an outgoing text. */
  businessName: string;
  clientName: string;
  clientPhone: string | null;
  /** Address, so a teammate reading a one-line text knows which job it is. */
  jobLabel: string;
  /** Where the client can read the thread and answer, when a proposal is out. */
  clientLink: string | null;
  /** Where a teammate lands to answer. */
  teamLink: string;
}

/**
 * Everything a conversation notification needs to say something useful,
 * fetched once per message rather than per recipient.
 *
 * Admin client throughout: the client's own message has no signed-in user at
 * all, and a teammate's message has to read other people's records.
 */
export async function jobThreadContext(jobId: string): Promise<JobThreadContext | null> {
  const admin = createAdminClient();

  const { data: job } = await admin.from("jobs").select("property_id, name").eq("id", jobId).maybeSingle();
  if (!job) return null;

  const { data: property } = await admin
    .from("properties")
    .select("customer_id, address")
    .eq("id", job.property_id)
    .maybeSingle();

  const { data: customer } = property
    ? await admin
        .from("customers")
        .select("name, phone, organization_id")
        .eq("id", property.customer_id)
        .maybeSingle()
    : { data: null };

  const { data: organization } = customer
    ? await admin.from("organizations").select("name").eq("id", customer.organization_id).maybeSingle()
    : { data: null };

  // The newest proposal is the one they have open; an older token still works
  // but points at a price that has been superseded.
  const { data: proposals } = await admin
    .from("job_proposals")
    .select("token")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1);
  const token = (proposals ?? [])[0]?.token as string | undefined;

  const baseUrl = await outboundBaseUrl();

  return {
    businessName: organization?.name ?? "",
    clientName: customer?.name ?? "",
    clientPhone: customer?.phone ?? null,
    jobLabel: property?.address ?? job.name ?? "",
    clientLink: token ? absolute(baseUrl, proposalPath(token)) : null,
    teamLink: absolute(baseUrl, `/conversations/job/${jobId}`),
  };
}
