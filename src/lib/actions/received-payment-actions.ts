"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { searchAddress } from "@/lib/mapbox-geocoding";
import { payerSearchTerm, type SearchableContact } from "@/lib/payer-match";

/** Results rather than throws — a thrown Server Action loses its message in
 * production and surfaces as an unexplained crash. */
export type ReconcileResult = { ok: true; jobId: string } | { ok: false; message: string };

function describe(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const e = err as { message: string; code?: string };
    return `${e.message}${e.code ? ` (${e.code})` : ""}`;
  }
  return "Something went wrong.";
}

async function assertAdmin(): Promise<string | null> {
  const profile = await getCurrentProfile();
  const allowed = profile?.roles.includes("admin") || profile?.roles.includes("overhead");
  return allowed ? null : "You do not have permission to move payments.";
}

/**
 * File these payments against a project.
 *
 * Takes a list rather than one payment, because the whole point is that a
 * deposit and the balance that followed it are one piece of work. Attaching
 * them one at a time leaves a window where half the money is on the project
 * and half is not, and somebody reads the total in between.
 */
export async function attachPaymentsToProject(
  paymentIds: string[],
  jobId: string
): Promise<ReconcileResult> {
  try {
    const denied = await assertAdmin();
    if (denied) return { ok: false, message: denied };
    if (paymentIds.length === 0) return { ok: false, message: "No payments to file." };
    if (!jobId) return { ok: false, message: "Pick a project." };

    const supabase = await createClient();
    const organizationId = await getCurrentOrganizationId();

    // The project has to exist, and the payments have to be ours. Without
    // both checks an id typed into a form could move somebody else's money.
    const { data: job } = await supabase.from("jobs").select("id").eq("id", jobId).maybeSingle();
    if (!job) return { ok: false, message: "That project no longer exists." };

    const { error } = await supabase
      .from("payments")
      .update({ job_id: jobId })
      .in("id", paymentIds)
      .eq("organization_id", organizationId);

    if (error) return { ok: false, message: describe(error) };

    revalidatePath("/admin/payments");
    revalidatePath(`/jobs/${jobId}`);
    return { ok: true, jobId };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/** Take payments back off a project, for when the guess was wrong. */
export async function detachPayments(paymentIds: string[]): Promise<ReconcileResult> {
  try {
    const denied = await assertAdmin();
    if (denied) return { ok: false, message: denied };
    if (paymentIds.length === 0) return { ok: false, message: "No payments to unfile." };

    const supabase = await createClient();
    const organizationId = await getCurrentOrganizationId();

    const { error } = await supabase
      .from("payments")
      .update({ job_id: null })
      .in("id", paymentIds)
      .eq("organization_id", organizationId);

    if (error) return { ok: false, message: describe(error) };

    revalidatePath("/admin/payments");
    return { ok: true, jobId: "" };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

export interface CreateProjectInput {
  customerId: string;
  name: string;
  paymentIds: string[];
  /** Needed only when the contact has no property on file yet. */
  address?: string | null;
}

/**
 * Make a project for money that has none, and file the money on it.
 *
 * This is the "we did work for this person" record the payment implies but
 * cannot make on its own. Marked completed, because the money arriving is the
 * evidence the work happened — a project sitting in `estimating` with a paid
 * invoice against it describes a state that never existed.
 */
export async function createProjectForPayments(
  input: CreateProjectInput
): Promise<ReconcileResult> {
  try {
    const denied = await assertAdmin();
    if (denied) return { ok: false, message: denied };

    const name = input.name.trim();
    if (!input.customerId) return { ok: false, message: "No contact on those payments." };
    if (!name) return { ok: false, message: "Give the project a name." };
    if (input.paymentIds.length === 0) return { ok: false, message: "No payments to file." };

    const supabase = await createClient();
    const organizationId = await getCurrentOrganizationId();

    const propertyId = await propertyFor(input.customerId, input.address ?? null);
    if (!propertyId.ok) return propertyId;

    const { data: created, error } = await supabase
      .from("jobs")
      .insert({
        property_id: propertyId.id,
        name,
        status: "completed",
        // The work is done and paid for; dating it from the money is the only
        // honest date we have.
        completed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error || !created) return { ok: false, message: describe(error) };

    const { error: linkError } = await supabase
      .from("payments")
      .update({ job_id: created.id })
      .in("id", input.paymentIds)
      .eq("organization_id", organizationId);

    // The project exists either way; say so rather than pretending nothing
    // happened, or the next attempt makes a second one.
    if (linkError) {
      return {
        ok: false,
        message: `Project created, but the payments could not be filed on it: ${describe(linkError)}`,
      };
    }

    revalidatePath("/admin/payments");
    revalidatePath(`/jobs/${created.id}`);
    return { ok: true, jobId: created.id };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

type PropertyResult = { ok: true; id: string } | { ok: false; message: string };

/**
 * The property to hang the project off.
 *
 * Reuses the contact's existing property when there is one — a second pin on
 * the same house is how one customer becomes two on the map. Otherwise the
 * address has to be supplied and geocoded, because lat and lng are not
 * nullable and inventing coordinates puts a real job in a field somewhere.
 */
async function propertyFor(customerId: string, address: string | null): Promise<PropertyResult> {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("properties")
    .select("id")
    .eq("customer_id", customerId)
    .limit(1)
    .maybeSingle();

  if (existing?.id) return { ok: true, id: existing.id };

  const typed = address?.trim();
  if (!typed) {
    return {
      ok: false,
      message: "This contact has no address on file. Add one so the project has a property.",
    };
  }

  let match: { lat: number; lng: number; fullAddress: string } | null = null;
  try {
    const results = await searchAddress(typed);
    match = results[0] ?? null;
  } catch (err) {
    return { ok: false, message: `Could not look that address up: ${describe(err)}` };
  }
  if (!match) return { ok: false, message: "No match for that address." };

  const { data: created, error } = await supabase
    .from("properties")
    .insert({
      customer_id: customerId,
      // The geocoder's own wording: it is the version that matches what the
      // coordinates actually point at.
      address: match.fullAddress,
      lat: match.lat,
      lng: match.lng,
    })
    .select("id")
    .single();

  if (error || !created) return { ok: false, message: describe(error) };
  return { ok: true, id: created.id };
}


/**
 * Say whose money this is.
 *
 * The screen used to stop here: money with no contact could not be filed, and
 * the only advice it gave was to add the contact and run the reconcile again.
 * That is a dead end on a phone, and it left real money sitting unattributed
 * because the one thing needed was a person to point at.
 *
 * Takes a list for the same reason attaching to a project does: a payer's
 * three payments are one person, and linking them one at a time leaves a
 * window where a total read in between is wrong.
 */
export async function linkPaymentsToCustomer(
  paymentIds: string[],
  customerId: string
): Promise<ReconcileResult> {
  try {
    const denied = await assertAdmin();
    if (denied) return { ok: false, message: denied };
    if (paymentIds.length === 0) return { ok: false, message: "No payments to link." };
    if (!customerId) return { ok: false, message: "Pick a contact." };

    const supabase = await createClient();
    const organizationId = await getCurrentOrganizationId();

    // The contact has to exist and be ours. Without the check, an id in a
    // form could file money against somebody else's book.
    const { data: customer } = await supabase
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!customer) return { ok: false, message: "That contact no longer exists." };

    const { error } = await supabase
      .from("payments")
      .update({ customer_id: customerId })
      .in("id", paymentIds)
      .eq("organization_id", organizationId);

    if (error) return { ok: false, message: describe(error) };

    revalidatePath("/admin/payments");
    revalidatePath(`/contacts/${customerId}`);
    // A contact who has paid us is a client rather than a lead, and that is
    // derived from the money rather than stored, so the pipeline only needs
    // telling to look again.
    revalidatePath("/pipeline");
    return { ok: true, jobId: "" };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/** Take a payment back off a contact, for when the link was wrong. */
export async function unlinkPaymentsFromCustomer(
  paymentIds: string[]
): Promise<ReconcileResult> {
  try {
    const denied = await assertAdmin();
    if (denied) return { ok: false, message: denied };
    if (paymentIds.length === 0) return { ok: false, message: "No payments to unlink." };

    const supabase = await createClient();
    const organizationId = await getCurrentOrganizationId();

    // The project goes too. A payment filed on a project belonging to the
    // contact it is being taken off would otherwise be left pointing at work
    // that is no longer theirs.
    const { error } = await supabase
      .from("payments")
      .update({ customer_id: null, job_id: null })
      .in("id", paymentIds)
      .eq("organization_id", organizationId);

    if (error) return { ok: false, message: describe(error) };

    revalidatePath("/admin/payments");
    revalidatePath("/pipeline");
    return { ok: true, jobId: "" };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

export type ContactSearchResult =
  | { ok: true; contacts: SearchableContact[] }
  | { ok: false; message: string };

/** How many contacts a search will hand back. Enough to find somebody on a
 * phone screen, few enough that the answer stays small. */
const SEARCH_LIMIT = 8;

/**
 * Contacts matching what somebody typed.
 *
 * Four fields and eight rows: this feeds a list you tap, not a page you read,
 * and shipping whole contact records to draw eight lines of text is how a
 * search box on a phone becomes slow.
 */
export async function searchContacts(query: string): Promise<ContactSearchResult> {
  try {
    const term = payerSearchTerm(query);
    if (!term) return { ok: true, contacts: [] };

    const supabase = await createClient();
    const organizationId = await getCurrentOrganizationId();

    // Commas and parentheses are how PostgREST separates the arms of an `or`,
    // so a name with one in it would be read as filter syntax rather than as
    // something to search for.
    const safe = term.replace(/[,()*\\]/g, " ").trim();
    if (!safe) return { ok: true, contacts: [] };

    const { data, error } = await supabase
      .from("customers")
      .select("id, name, email, phone")
      .eq("organization_id", organizationId)
      .or(`name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`)
      .order("name")
      .limit(SEARCH_LIMIT);

    if (error) return { ok: false, message: describe(error) };
    return { ok: true, contacts: (data ?? []) as SearchableContact[] };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}
