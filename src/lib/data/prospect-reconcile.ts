import type { SupabaseClient } from "@supabase/supabase-js";

import { findDuplicateCustomer, normalizeAddress } from "@/lib/dedupe";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Checks the prospect list against the client book and retires anyone who has
 * since become a customer.
 *
 * A prospect list goes stale the moment somebody on it calls in. Without this,
 * a homeowner who booked online last week is still sitting in the cold-call
 * queue — which is the one mistake on a list like this that a client actually
 * notices.
 *
 * Matches the same way the rest of the app does: address first, since that's
 * what a parcel list is keyed on, then email, phone, and name against the
 * customer record.
 */

export interface ReconcileReport {
  checked: number;
  matched: number;
}

type Client = SupabaseClient<Database>;

export async function reconcileProspects(supabase: Client): Promise<ReconcileReport> {
  const { data: prospects, error } = await supabase
    .from("lead_prospects")
    .select("id, address_key, owner_name, phone, email")
    .neq("status", "converted")
    .eq("do_not_contact", false);

  // The table may not exist yet on an installation that hasn't run the
  // migration; that's not an error worth failing a cron over.
  if (error || !prospects || prospects.length === 0) {
    return { checked: 0, matched: 0 };
  }

  const [{ data: properties }, { data: customers }] = await Promise.all([
    supabase.from("properties").select("address, customer_id"),
    supabase.from("customers").select("id, name, email, phone"),
  ]);

  const customerByAddress = new Map<string, string>();
  for (const property of properties ?? []) {
    const key = normalizeAddress(property.address);
    if (key) customerByAddress.set(key, property.customer_id);
  }

  const customerList = (customers ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
  }));

  const matches: { id: string; customerId: string }[] = [];

  for (const prospect of prospects) {
    const byAddress = customerByAddress.get(prospect.address_key);
    if (byAddress) {
      matches.push({ id: prospect.id, customerId: byAddress });
      continue;
    }

    // An owner name on its own is weak, but paired with the rest of the
    // matcher's rules it's the same standard used everywhere else.
    const byPerson = findDuplicateCustomer(customerList, {
      name: prospect.owner_name,
      email: prospect.email,
      phone: prospect.phone,
    });
    if (byPerson) matches.push({ id: prospect.id, customerId: byPerson.id });
  }

  for (const match of matches) {
    await supabase
      .from("lead_prospects")
      .update({ status: "converted", converted_customer_id: match.customerId })
      .eq("id", match.id);
  }

  return { checked: prospects.length, matched: matches.length };
}
