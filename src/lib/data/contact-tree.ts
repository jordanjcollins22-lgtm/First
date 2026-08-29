import { createClient } from "@/lib/supabase/server";
import { buildContactTree, type ContactNode } from "@/lib/contact-tree";

/**
 * Every person on the books, with their properties and the work on each.
 *
 * Four queries and an assembly, rather than a query per contact. The joins
 * exist in the database already; what did not exist was anywhere that read
 * them as one shape, so every screen rebuilt a piece of it and none of them
 * agreed.
 */
export async function getContactTree(): Promise<ContactNode[]> {
  const supabase = await createClient();

  const [contacts, properties, jobs, proposals] = await Promise.all([
    supabase.from("customers").select("id, name, email, phone, contact_type, do_not_contact"),
    supabase.from("properties").select("id, customer_id, address, acreage"),
    supabase
      .from("jobs")
      .select(
        "id, property_id, name, status, job_number, evaluation_date, project_start_date, project_end_date, created_at"
      ),
    supabase.from("job_proposals").select("job_id, status, total_cost"),
  ]);

  return buildContactTree({
    contacts: ((contacts.data ?? []) as {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      contact_type: string;
      do_not_contact: boolean;
    }[]).map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      contactType: c.contact_type,
      doNotContact: c.do_not_contact,
    })),
    properties: ((properties.data ?? []) as {
      id: string;
      customer_id: string;
      address: string;
      acreage: number | null;
    }[]).map((p) => ({
      id: p.id,
      customerId: p.customer_id,
      address: p.address,
      acreage: p.acreage,
    })),
    jobs: ((jobs.data ?? []) as {
      id: string;
      property_id: string;
      name: string;
      status: string;
      job_number: number | null;
      evaluation_date: string | null;
      project_start_date: string | null;
      project_end_date: string | null;
      created_at: string | null;
    }[]).map((j) => ({
      id: j.id,
      propertyId: j.property_id,
      name: j.name,
      status: j.status,
      jobNumber: j.job_number,
      evaluationDate: j.evaluation_date,
      projectStartDate: j.project_start_date,
      projectEndDate: j.project_end_date,
      createdAt: j.created_at,
    })),
    proposals: ((proposals.data ?? []) as {
      job_id: string;
      status: string;
      total_cost: number | null;
    }[]).map((p) => ({ jobId: p.job_id, status: p.status, totalCost: p.total_cost })),
  });
}
