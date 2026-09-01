import { createClient } from "@/lib/supabase/server";
import { checkHarford } from "@/lib/harford";
import { effectiveType } from "@/lib/client-status";
import { findDuplicateCustomer, normalizeAddress } from "@/lib/dedupe";
import { fetchAllRows } from "@/lib/pagination";

export interface ContactRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  propertyCount: number;
  addresses: string[];
  /**
   * What this contact is, given the money.
   *
   * Derived rather than read off the row: a client is somebody who has paid
   * us, and a book where a thousand people are called clients is a book where
   * the word carries no information. A supplier stays a supplier whichever
   * way money went.
   */
  contactType: string;
  /** What the row itself says, kept so a screen can show that the book and
   * the money disagree rather than silently overruling one with the other. */
  statedType: string;
  /** What they have actually paid, in cents. */
  paidCents: number;
  /** How many invoices we have raised against them. A billed contact is a
   * client whether or not a payment can be joined to the bill. */
  invoiceCount: number;
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

export interface OutOfAreaContact {
  id: string;
  name: string;
  address: string;
  /** What gave it away, so it can be judged without opening the record. */
  reason: string;
}

interface CustomerQueryRow {
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
  /**
   * Contacts whose address cannot be in Harford County.
   *
   * Almost always a bad address rather than a customer three states away:
   * a geocoder that guessed, or a town name typed without its state. It
   * lives with the contacts because it is contact data to fix, not a lead
   * to chase.
   */
  outOfArea: OutOfAreaContact[];
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

  // Paged, because a select with no range comes back capped at a thousand
  // rows and says nothing about it. The book is past that, so the unpaged
  // version quietly stopped at the letter M -- the page rendered, the numbers
  // looked plausible, and eight hundred people were not in it.
  const [data, { count: pendingGeocodes }, { count: failedGeocodes }] = await Promise.all([
    fetchAllRows<CustomerQueryRow>((from, to) =>
      supabase
        .from("customers")
        .select(
          "id, name, email, phone, contact_type, tags, do_not_contact, pipeline, pipeline_stage, opportunity_value, properties(id, address)"
        )
        .order("name")
        .range(from, to)
    ),
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

  // What each contact has actually paid, which is what decides whether they
  // are a client. Tolerated: before the payments table has anything in it
  // nobody has paid, which is a true answer rather than a broken page.
  const paidByCustomer = new Map<string, number>();
  try {
    // Paged for the same reason. Under a thousand payments today, and the
    // day it goes over is the day every contact past that point silently
    // stops counting as a client.
    const paid = await fetchAllRows<{ customer_id: string | null; amount_cents: number }>(
      (from, to) =>
        supabase.from("payments").select("customer_id, amount_cents").range(from, to)
    );
    for (const row of paid) {
      if (!row.customer_id) continue;
      paidByCustomer.set(
        row.customer_id,
        (paidByCustomer.get(row.customer_id) ?? 0) + (row.amount_cents ?? 0)
      );
    }
  } catch {
    // Nobody has paid, as far as anybody can tell.
  }

  // How many bills each contact has had. Tolerated the same way the payments
  // read is: before the invoices table exists nobody has been billed, which
  // is a true answer rather than a broken page.
  const invoicesByCustomer = new Map<string, number>();
  try {
    const billed = await fetchAllRows<{ customer_id: string }>((from, to) =>
      supabase.from("client_invoices").select("customer_id").range(from, to)
    );
    for (const row of billed) {
      if (!row.customer_id) continue;
      invoicesByCustomer.set(row.customer_id, (invoicesByCustomer.get(row.customer_id) ?? 0) + 1);
    }
  } catch {
    // Nobody has been billed, as far as anybody can tell.
  }

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

  const contacts: ContactRow[] = data.map((c) => ({
    contactType: effectiveType({
      paidCents: paidByCustomer.get(c.id) ?? 0,
      invoiceCount: invoicesByCustomer.get(c.id) ?? 0,
      contactType: c.contact_type,
    }),
    statedType: c.contact_type ?? "",
    paidCents: paidByCustomer.get(c.id) ?? 0,
    invoiceCount: invoicesByCustomer.get(c.id) ?? 0,
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

  // Grown as we go rather than sliced each time round. `slice` here allocated
  // a fresh array of every earlier contact on every iteration, which on a book
  // of eighteen hundred is eighteen hundred copies averaging nine hundred
  // entries -- work nobody asked for, on every page load.
  const earlier: ContactRow[] = [];

  for (const contact of contacts) {
    if (alreadyPaired.has(contact.id)) {
      earlier.push(contact);
      continue;
    }

    // Compared against everyone earlier in the list, so each pair surfaces once.
    const match = findDuplicateCustomer(earlier, contact);
    earlier.push(contact);
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
  //
  // Indexed by address rather than compared pair by pair. The pairwise version
  // normalised both addresses inside the innermost loop, so an eighteen
  // hundred contact book meant more than a million comparisons and several
  // million string normalisations before the page could render. Two contacts
  // share an address exactly when they land in the same bucket.
  const byAddress = new Map<string, ContactRow[]>();
  for (const contact of contacts) {
    for (const address of new Set(contact.addresses.map(normalizeAddress))) {
      if (!address) continue;
      const bucket = byAddress.get(address);
      if (bucket) bucket.push(contact);
      else byAddress.set(address, [contact]);
    }
  }

  for (const bucket of byAddress.values()) {
    if (bucket.length < 2) continue;

    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i];
        const b = bucket[j];
        if (alreadyPaired.has(a.id) || alreadyPaired.has(b.id)) continue;

        const [keep, merge] = a.propertyCount >= b.propertyCount ? [a, b] : [b, a];
        duplicates.push({ keep, merge, reason: "Same property address" });
        alreadyPaired.add(a.id);
        alreadyPaired.add(b.id);
      }
    }
  }

  // Only the ones a check can be sure about. An address it cannot read is
  // not evidence of anything, and a list of two hundred fine addresses is a
  // list nobody opens.
  const outOfArea: OutOfAreaContact[] = [];
  for (const contact of contacts) {
    for (const address of contact.addresses) {
      const check = checkHarford({ address });
      if (check.verdict !== "outside") continue;
      outOfArea.push({ id: contact.id, name: contact.name, address, reason: check.reason });
      // One row per contact: the point is to open them and fix it, and four
      // rows for one person is four times the work to tick off.
      break;
    }
  }

  return {
    contacts,
    duplicates,
    pendingGeocodes: pendingGeocodes ?? 0,
    failedGeocodes: failedGeocodes ?? 0,
    recentMerges,
    outOfArea,
  };
}
