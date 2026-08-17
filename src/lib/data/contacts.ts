import { createClient } from "@/lib/supabase/server";
import { findDuplicateCustomer, normalizeAddress } from "@/lib/dedupe";

export interface ContactRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  propertyCount: number;
  addresses: string[];
}

export interface DuplicatePair {
  keep: ContactRow;
  merge: ContactRow;
  /** Why these two were paired up, shown so the decision isn't blind. */
  reason: string;
}

export interface ContactsData {
  contacts: ContactRow[];
  duplicates: DuplicatePair[];
}

/**
 * Every contact, plus the pairs that look like the same person.
 *
 * Suggestions only — nothing is merged without somebody choosing to. Existing
 * records have jobs and proposals attached, and a wrong automatic merge there
 * isn't recoverable.
 */
export async function getContacts(): Promise<ContactsData> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("customers")
    .select("id, name, email, phone, properties(id, address)")
    .order("name");
  if (error) throw error;

  const contacts: ContactRow[] = (
    (data ?? []) as unknown as {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      properties: { id: string; address: string }[] | null;
    }[]
  ).map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    propertyCount: c.properties?.length ?? 0,
    addresses: (c.properties ?? []).map((p) => p.address),
  }));

  const duplicates: DuplicatePair[] = [];
  const alreadyPaired = new Set<string>();

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    if (alreadyPaired.has(contact.id)) continue;

    // Compare against everyone earlier in the list, so each pair surfaces once.
    const earlier = contacts.slice(0, i);
    const match = findDuplicateCustomer(earlier, contact);
    if (!match || alreadyPaired.has(match.id)) continue;
    // The matcher answers with its own narrow shape; we need the full row.
    const hit = contacts.find((c) => c.id === match.id)!;

    const reason =
      hit.email && contact.email && hit.email.toLowerCase() === contact.email.toLowerCase()
        ? "Same email"
        : hit.phone && contact.phone
          ? "Same phone number"
          : "Same name";

    // Keep whichever has more attached to it — less to move, less to lose.
    const [keep, merge] = hit.propertyCount >= contact.propertyCount ? [hit, contact] : [contact, hit];

    duplicates.push({ keep, merge, reason });
    alreadyPaired.add(contact.id);
    alreadyPaired.add(hit.id);
  }

  // Same address under two contacts is worth a look even when the names differ
  // — though it can legitimately be a duplex, so it's only ever a suggestion.
  for (let i = 0; i < contacts.length; i++) {
    for (let j = i + 1; j < contacts.length; j++) {
      const a = contacts[i];
      const b = contacts[j];
      if (alreadyPaired.has(a.id) || alreadyPaired.has(b.id)) continue;

      const shared = a.addresses.some((addrA) =>
        b.addresses.some((addrB) => normalizeAddress(addrA) === normalizeAddress(addrB))
      );
      if (!shared) continue;

      const [keep, merge] = a.propertyCount >= b.propertyCount ? [a, b] : [b, a];
      duplicates.push({ keep, merge, reason: "Same property address" });
      alreadyPaired.add(a.id);
      alreadyPaired.add(b.id);
    }
  }

  return { contacts, duplicates };
}
