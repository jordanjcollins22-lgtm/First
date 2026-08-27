import { createAdminClient } from "@/lib/supabase/admin";
import type { JobProposal } from "@/types/domain";

export interface PublicProposal {
  proposal: JobProposal;
  /** Service names by their type id, so a proposal snapshotted while the
   * label lookup was broken still shows a name rather than a uuid. */
  serviceNames: Record<string, string>;
  propertyAddress: string;
  customerName: string;
  organizationName: string;
}

export async function getProposalByToken(token: string): Promise<PublicProposal | null> {
  const admin = createAdminClient();

  const { data: proposal, error } = await admin.from("job_proposals").select("*").eq("token", token).maybeSingle();
  if (error) throw error;
  if (!proposal) return null;

  const { data: job, error: jobError } = await admin
    .from("jobs")
    .select("property_id")
    .eq("id", proposal.job_id)
    .maybeSingle();
  if (jobError) throw jobError;
  if (!job) return null;

  const { data: property, error: propertyError } = await admin
    .from("properties")
    .select("address, customer_id")
    .eq("id", job.property_id)
    .maybeSingle();
  if (propertyError) throw propertyError;
  if (!property) return null;

  const { data: customer, error: customerError } = await admin
    .from("customers")
    .select("name, organization_id")
    .eq("id", property.customer_id)
    .maybeSingle();
  if (customerError) throw customerError;

  const { data: org, error: orgError } = customer
    ? await admin.from("organizations").select("name").eq("id", customer.organization_id).maybeSingle()
    : { data: null, error: null };
  if (orgError) throw orgError;

  // Proposals are snapshots, so the ones generated before custom services
  // resolved their names still hold `custom-<uuid>` in serviceLabel.
  // Rebuilding fixes them properly; this keeps a database id off a client's
  // screen until somebody does.
  const { data: pricing } = await admin
    .from("services")
    .select("service_type_id, name")
    .eq("organization_id", customer?.organization_id ?? "");

  const serviceNames: Record<string, string> = {};
  for (const row of (pricing ?? []) as { service_type_id: string; name: string }[]) {
    serviceNames[row.service_type_id] = row.name;
  }

  return {
    proposal: proposal as unknown as JobProposal,
    serviceNames,
    propertyAddress: property.address,
    customerName: customer?.name ?? "",
    organizationName: org?.name ?? "",
  };
}
