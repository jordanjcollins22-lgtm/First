"use server";

import { randomBytes } from "crypto";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { ACCEPTED_TYPES, extensionFor, MAX_FILE_BYTES } from "@/lib/client-invoices";

/** Results rather than throws — a thrown Server Action loses its message in
 * production and surfaces as an unexplained crash. */
export type InvoiceResult<T = object> = ({ ok: true } & T) | { ok: false; message: string };

function describe(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const e = err as { message: string; code?: string };
    return `${e.message}${e.code ? ` (${e.code})` : ""}`;
  }
  return "Something went wrong.";
}

/** A date the database will take, or null. Anything unreadable is refused
 * rather than stored as a date that means nothing. */
function dateOrNull(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

/** An amount from whatever somebody typed, in dollars. Currency symbols and
 * thousands separators are what a person pastes out of accounting software. */
function amountOrNull(value: string | undefined): number | null {
  const text = value?.replace(/[^0-9.]/g, "").trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * A place to put the file, before the file goes anywhere.
 *
 * The browser uploads straight to storage with a short-lived signed URL, and
 * only the path comes back through an action. Server Actions carry a one
 * megabyte body and a scanned invoice is several — sending the file through
 * the app would fail on exactly the documents somebody most wants to keep.
 */
export async function createInvoiceUpload(input: {
  customerId: string;
  fileType: string;
  fileSize: number;
}): Promise<InvoiceResult<{ path: string; token: string }>> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Not signed in." };
    if (!input.customerId) return { ok: false, message: "Pick a contact first." };
    if (!ACCEPTED_TYPES.includes(input.fileType)) {
      return { ok: false, message: "That needs to be a PDF, a PNG or a JPG." };
    }
    if (input.fileSize > MAX_FILE_BYTES) {
      return { ok: false, message: "That file is too big to store." };
    }
    if (input.fileSize === 0) return { ok: false, message: "That file is empty." };

    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();

    const path = `${organizationId}/${input.customerId}/${randomBytes(16).toString("hex")}.${extensionFor(input.fileType)}`;
    const { data, error } = await supabase.storage.from("invoices").createSignedUploadUrl(path);
    if (error || !data) {
      return { ok: false, message: error?.message ?? "Couldn't get a place to put that." };
    }

    return { ok: true, path, token: data.token };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/**
 * Records the invoice once its file is up.
 *
 * Only the contact and the file are required. The rest is typed off a
 * document somebody is looking at, and refusing the upload because a due date
 * has not been found yet is how a stack of invoices stays in an inbox.
 */
export async function saveInvoice(input: {
  customerId: string;
  filePath: string;
  fileName: string;
  invoiceNumber?: string;
  amount?: string;
  issuedOn?: string;
  dueOn?: string;
  paidOn?: string;
  notes?: string;
}): Promise<InvoiceResult<{ id: string }>> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };
    if (!input.customerId) return { ok: false, message: "Pick a contact." };
    if (!input.filePath) return { ok: false, message: "No file to save." };

    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();

    // The contact has to be ours. Without the check, an id in a form could
    // file a document against somebody else's book.
    const { data: customer } = await supabase
      .from("customers")
      .select("id")
      .eq("id", input.customerId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!customer) return { ok: false, message: "That contact no longer exists." };

    const { data: created, error } = await supabase
      .from("client_invoices")
      .insert({
        organization_id: organizationId,
        customer_id: input.customerId,
        file_path: input.filePath,
        file_name: input.fileName,
        invoice_number: input.invoiceNumber?.trim() || null,
        amount: amountOrNull(input.amount),
        issued_on: dateOrNull(input.issuedOn),
        due_on: dateOrNull(input.dueOn),
        paid_on: dateOrNull(input.paidOn),
        notes: input.notes?.trim() || null,
        created_by: profile.id,
      })
      .select("id")
      .single();

    if (error || !created) return { ok: false, message: describe(error) };

    revalidatePath("/admin/payments");
    revalidatePath(`/clients/${input.customerId}`);
    return { ok: true, id: created.id };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/**
 * Correcting one after the fact, which is most of them: these are typed in
 * from a document somebody is squinting at.
 *
 * Marking one paid is the common case and goes through here too. Only the
 * fields actually passed are touched, so recording a payment date does not
 * quietly blank a due date somebody entered last week.
 */
export async function updateInvoice(
  id: string,
  patch: {
    invoiceNumber?: string;
    amount?: string;
    issuedOn?: string;
    dueOn?: string;
    paidOn?: string;
    notes?: string;
  }
): Promise<InvoiceResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Not signed in." };

    const supabase = await createClient();
    const organizationId = await getCurrentOrganizationId();

    const { error } = await supabase
      .from("client_invoices")
      .update({
        ...(patch.invoiceNumber !== undefined
          ? { invoice_number: patch.invoiceNumber.trim() || null }
          : {}),
        ...(patch.amount !== undefined ? { amount: amountOrNull(patch.amount) } : {}),
        ...(patch.issuedOn !== undefined ? { issued_on: dateOrNull(patch.issuedOn) } : {}),
        ...(patch.dueOn !== undefined ? { due_on: dateOrNull(patch.dueOn) } : {}),
        ...(patch.paidOn !== undefined ? { paid_on: dateOrNull(patch.paidOn) } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes.trim() || null } : {}),
      })
      .eq("id", id)
      .eq("organization_id", organizationId);

    if (error) return { ok: false, message: describe(error) };

    revalidatePath("/admin/payments");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/** Move an invoice onto a different contact, for when it was filed against
 * the wrong one. Filing is a few taps, so misfiling has to be too. */
export async function relinkInvoice(id: string, customerId: string): Promise<InvoiceResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Not signed in." };
    if (!customerId) return { ok: false, message: "Pick a contact." };

    const supabase = await createClient();
    const organizationId = await getCurrentOrganizationId();

    const { data: customer } = await supabase
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!customer) return { ok: false, message: "That contact no longer exists." };

    const { error } = await supabase
      .from("client_invoices")
      .update({ customer_id: customerId })
      .eq("id", id)
      .eq("organization_id", organizationId);

    if (error) return { ok: false, message: describe(error) };

    revalidatePath("/admin/payments");
    revalidatePath(`/clients/${customerId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

/**
 * A link to read the file, good for a few minutes.
 *
 * The bucket is private on purpose: an invoice carries a client's name, their
 * address and what they were charged, and a public URL is a filing cabinet
 * anybody who guesses it can read. So the link is minted per view, for
 * somebody signed in.
 */
export async function invoiceFileLink(filePath: string): Promise<InvoiceResult<{ url: string }>> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Not signed in." };

    const supabase = await createClient();
    const { data, error } = await supabase.storage.from("invoices").createSignedUrl(filePath, 300);
    if (error || !data) return { ok: false, message: error?.message ?? "Couldn't open that." };

    return { ok: true, url: data.signedUrl };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}

export async function deleteInvoice(id: string, filePath: string): Promise<InvoiceResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Not signed in." };

    const supabase = await createClient();
    const organizationId = await getCurrentOrganizationId();

    const { error } = await supabase
      .from("client_invoices")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId);
    if (error) return { ok: false, message: describe(error) };

    // The row is the record. A file left behind is invisible clutter rather
    // than a problem, so a failure here is not worth failing the delete over.
    try {
      await supabase.storage.from("invoices").remove([filePath]);
    } catch {
      // Left where it is.
    }

    revalidatePath("/admin/payments");
    return { ok: true };
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}
