import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import { summariseOutreach, type OutreachSummary, type Touch } from "@/lib/flyer-outreach";

export interface FlyerBusiness {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  summary: OutreachSummary;
  /** Every touch, newest first, for the history under a row. */
  touches: Touch[];
}

/**
 * The businesses we are working for flyer spots, with what happened.
 *
 * Two queries rather than one per business. The touches are grouped here so
 * the count on a row and the history under it can never disagree.
 */
export async function listFlyerBusinesses(): Promise<FlyerBusiness[]> {
  const supabase = await createClient();

  const { data: businesses, error } = await supabase
    .from("customers")
    .select("id, name, phone, email, notes")
    .eq("contact_type", "business")
    .order("name");

  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  const rows = (businesses ?? []) as {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    notes: string | null;
  }[];
  if (rows.length === 0) return [];

  const { data: touches } = await supabase
    .from("outreach_touches")
    .select("customer_id, outcome, note, at")
    .in(
      "customer_id",
      rows.map((r) => r.id)
    );

  const byCustomer = new Map<string, Touch[]>();
  for (const row of ((touches ?? []) as {
    customer_id: string | null;
    outcome: string;
    note: string | null;
    at: string;
  }[])) {
    if (!row.customer_id) continue;
    const list = byCustomer.get(row.customer_id) ?? [];
    list.push({ outcome: row.outcome, note: row.note, at: row.at });
    byCustomer.set(row.customer_id, list);
  }

  return rows.map((row) => {
    const list = (byCustomer.get(row.id) ?? []).sort((a, b) => (a.at < b.at ? 1 : -1));
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      notes: row.notes,
      summary: summariseOutreach(list),
      touches: list,
    };
  });
}
