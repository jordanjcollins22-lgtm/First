import { createAdminClient } from "@/lib/supabase/admin";
import type { JobProposal } from "@/types/domain";

export interface PublicProposal {
  proposal: JobProposal;
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

  return {
    proposal: proposal as unknown as JobProposal,
    propertyAddress: property.address,
    customerName: customer?.name ?? "",
    organizationName: org?.name ?? "",
  };
}
