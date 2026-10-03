import { createAdminClient } from "@/lib/supabase/admin";

export interface JobCustomerContact {
  customerId: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  organizationId: string;
}

/** Job -> property -> customer, for anything that needs to reach the client
 * directly (SMS, calling, invoicing). Uses the admin client since it's a
 * cross-cutting lookup called from several contexts, not a page render.
 * `jobs` has no organization_id column of its own — it's derived here via
 * the customer, same as the RLS policies do. */
export async function getJobCustomerContact(jobId: string): Promise<JobCustomerContact | null> {
  const admin = createAdminClient();

  const { data: job } = await admin.from("jobs").select("property_id").eq("id", jobId).maybeSingle();
  if (!job) return null;

  const { data: property } = await admin.from("properties").select("customer_id").eq("id", job.property_id).maybeSingle();
  if (!property) return null;

  const { data: customer } = await admin
    .from("customers")
    .select("id, name, phone, email, organization_id")
    .eq("id", property.customer_id)
    .maybeSingle();
  if (!customer) return null;

  return {
    customerId: customer.id,
    customerName: customer.name,
    phone: customer.phone,
    email: customer.email,
    organizationId: customer.organization_id,
  };
}
