import { createClient } from "@/lib/supabase/server";
import { findDuplicateCustomer, normalizeAddress } from "@/lib/dedupe";

export interface ContactRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  propertyCount: number;
  addresses: string[];
  /** client, lead, supplier, subcontractor, referral_partner or other. */
  contactType: string;
  tags: string[];
  /** Asked not to be contacted. Shown on the row, because the whole reason to
   * carry it across from the CRM is that somebody sees it before they ring. */
  doNotContact: boolean;
  /** What the CRM had them at, kept verbatim rather than mapped onto this
   * app's own stages. */
  pipelineStage: string | null;
  opportunityValue: number | null;
}

/** How many imported addresses are still waiting to be placed on the map, so
 * the Contacts page can offer the step rather than leaving somebody to wonder
 * why their import is invisible on Project Data. */
export interface DuplicatePair {
  keep: ContactRow;
  merge: ContactRow;
  /** Why these two were paired up, shown so the decision isn't blind. */
  reason: string;
}

export interface MergeRecord {
  id: string;
  keptName: string;
  mergedName: string;
  movedProperties: number;
  mergedAt: string;
  undoneAt: string | null;
}

export interface ContactsData {
  contacts: ContactRow[];
  duplicates: DuplicatePair[];
  /** Imported addresses not yet placed on the map. Until they are, those
   * contacts have no property and appear nowhere that draws one. */
  pendingGeocodes: number;
  /** Addresses a lookup could not place — usually partial, and needing a
   * human. Counted so they are visible rather than quietly absent forever. */
  failedGeocodes: number;
  /** The last few merges, each of which deleted somebody. Kept in front of
   * whoever is merging rather than behind a menu — an undo you have to go
   * looking for is one you find after forty more merges. */
  recentMerges: MergeRecord[];
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

  const [{ data, error }, { count: pendingGeocodes }, { count: failedGeocodes }] = await Promise.all([
    supabase
      .from("customers")
      .select(
        "id, name, email, phone, contact_type, tags, do_not_contact, pipeline, pipeline_stage, opportunity_value, properties(id, address)"
      )
      .order("name"),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .not("import_address", "is", null)
      .is("geocode_attempted_at", null),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .not("geocode_error", "is", null),
  ]);
  if (error) throw error;

  // Empty until migration 0091 runs, and empty is the right answer then: with
  // no record of a merge there is nothing to offer an undo for.
  const { data: mergeRows } = await supabase
    .from("contact_merges")
    .select("id, kept_name, merged_name, moved_property_ids, merged_at, undone_at")
    .order("merged_at", { ascending: false })
    .limit(10);

  const recentMerges: MergeRecord[] = (
    (mergeRows ?? []) as unknown as {
      id: string;
      kept_name: string;
      merged_name: string;
      moved_property_ids: string[] | null;
      merged_at: string;
      undone_at: string | null;
    }[]
  ).map((m) => ({
    id: m.id,
    keptName: m.kept_name,
    mergedName: m.merged_name,
    movedProperties: (m.moved_property_ids ?? []).length,
    mergedAt: m.merged_at,
    undoneAt: m.undone_at,
  }));

  const contacts: ContactRow[] = (
    (data ?? []) as unknown as {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      contact_type: string | null;
      tags: string[] | null;
      do_not_contact: boolean | null;
      pipeline: string | null;
      pipeline_stage: string | null;
      opportunity_value: number | null;
      properties: { id: string; address: string }[] | null;
    }[]
  ).map((c) => ({
    contactType: c.contact_type ?? "client",
    tags: c.tags ?? [],
    doNotContact: c.do_not_contact ?? false,
    pipelineStage: c.pipeline_stage,
    opportunityValue: c.opportunity_value != null ? Number(c.opportunity_value) : null,
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

  return {
    contacts,
    duplicates,
    pendingGeocodes: pendingGeocodes ?? 0,
    failedGeocodes: failedGeocodes ?? 0,
    recentMerges,
  };
}
