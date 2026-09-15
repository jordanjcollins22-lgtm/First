"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { findDuplicateCustomer } from "@/lib/dedupe";
import { chunk } from "@/lib/chunk";
import {
  isBillable,
  parseInvoiceCsv,
  previewInvoices,
  previewLine,
  type InvoiceDraft,
  type InvoicePreview,
} from "@/lib/invoice-import";

export interface ImportInvoicesResult {
  ok: boolean;
  message: string;
  preview?: InvoicePreview;
  /** Invoices whose contact could not be found, named so somebody can go
   * and add them rather than wondering what went missing. */
  unmatched?: string[];
}

interface ClientRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  external_id: string | null;
}

const BATCH = 200;

/** Read the file and say what is in it, writing nothing. Nobody should have
 * to import a file to find out what importing it would do. */
export async function previewInvoiceCsv(csvText: string): Promise<ImportInvoicesResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Not signed in." };

    const report = parseInvoiceCsv(csvText);
    const preview = previewInvoices(report.drafts);
    return { ok: true, message: previewLine(preview), preview };
  } catch (err) {
    console.error("previewInvoiceCsv failed:", err);
    return { ok: false, message: "Couldn't read that file." };
  }
}

/**
 * Brings a file of invoices in.
 *
 * Upserted on the exporting system's own invoice number, so running the same
 * file twice updates rather than billing everybody twice.
 *
 * Contacts are matched, never created. That is the one real difference from
 * the payments import: a payment with no contact is money that has to land
 * somewhere, so a contact gets made for it. An invoice with no contact is a
 * bill for somebody who is not in the book, which means the book is missing
 * them — and inventing a contact from a bill would put a lead in the pipeline
 * who was never a lead. They are named instead, so somebody can decide.
 */
export async function importInvoices(
  csvText: string,
  sourceName = "import"
): Promise<ImportInvoicesResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };

    const supabase = await createClient();
    const organizationId = await getCurrentOrganizationId();

    const report = parseInvoiceCsv(csvText);
    const preview = previewInvoices(report.drafts);
    if (report.drafts.length === 0) {
      return { ok: false, message: "Nothing in that file to bring in." };
    }

    const clients = await loadClients(supabase, organizationId);
    const rows: Record<string, unknown>[] = [];
    const unmatched: string[] = [];

    for (const draft of report.drafts) {
      // A test row is not a bill and a voided one was withdrawn. Both are
      // counted in the preview and neither is written.
      if (!isBillable(draft)) continue;

      const client = matchClient(draft, clients);
      if (!client) {
        const who = draft.customerName ?? draft.customerEmail ?? draft.externalId ?? "someone";
        if (!unmatched.includes(who)) unmatched.push(who);
        continue;
      }

      rows.push({
        organization_id: organizationId,
        customer_id: client.id,
        // No file: this came from an export rather than from somebody
        // uploading a PDF. The columns are nullable for exactly this.
        file_path: null,
        file_name: null,
        invoice_number: draft.externalId,
        title: draft.title,
        amount: draft.totalCents == null ? null : draft.totalCents / 100,
        subtotal: draft.subtotalCents == null ? null : draft.subtotalCents / 100,
        discount: draft.discountCents == null ? null : draft.discountCents / 100,
        issued_on: draft.issuedOn,
        due_on: draft.dueOn,
        // Left null on purpose. The export says whether it was paid but never
        // when, and a date invented from the due date would be a fact nobody
        // can check. The source's word is recorded below instead.
        paid_on: null,
        scope_html: draft.scopeHtml,
        source_status: draft.status,
        source: sourceName.trim() || "import",
        external_id: draft.externalId,
        created_by: profile.id,
      });
    }

    if (rows.length === 0) {
      return {
        ok: false,
        message:
          unmatched.length > 0
            ? `Nobody in the book matches any of these ${unmatched.length} invoices. Import the contacts first.`
            : "Nothing in that file to bring in.",
        preview,
        unmatched: unmatched.slice(0, 20),
      };
    }

    for (const batch of chunk(rows, BATCH)) {
      const withId = batch.filter((r) => r.external_id);
      const withoutId = batch.filter((r) => !r.external_id);

      if (withId.length > 0) {
        const { error } = await supabase
          .from("client_invoices")
          .upsert(withId as never, { onConflict: "organization_id,external_id" });
        if (error) return { ok: false, message: describeImportError(error), preview };
      }
      if (withoutId.length > 0) {
        const { error } = await supabase.from("client_invoices").insert(withoutId as never);
        if (error) return { ok: false, message: describeImportError(error), preview };
      }
    }

    revalidatePath("/admin/payments");

    const parts = [`${rows.length} invoices in.`];
    if (unmatched.length > 0) {
      parts.push(
        `${unmatched.length} could not be matched to anybody in the book and were left out.`
      );
    }
    if (preview.testRows > 0) parts.push(`${preview.testRows} test rows skipped.`);
    if (preview.withScope > 0) parts.push(`${preview.withScope} brought their scope of work.`);

    return {
      ok: true,
      message: parts.join(" "),
      preview,
      unmatched: unmatched.slice(0, 20),
    };
  } catch (err) {
    console.error("importInvoices failed:", err);
    return { ok: false, message: "Couldn't import that file." };
  }
}

/** Postgres and PostgREST codes that genuinely mean a migration has not run. */
const MIGRATION_CODES = new Set(["42703", "42P10", "PGRST204", "PGRST205"]);

/**
 * What actually went wrong, said plainly.
 *
 * Narrow on purpose. Answering "run the migration" to anything containing the
 * word "constraint" sends somebody to fix a thing that is not broken, which
 * costs more than saying nothing would have.
 */
function describeImportError(error: { message: string; code?: string; details?: string | null }) {
  const missing = /does not exist|schema cache/i.test(error.message);
  if (MIGRATION_CODES.has(error.code ?? "") || missing) {
    return `This needs its database migration. Run supabase/migrations/0142_client_invoices.sql through 0144_invoice_import.sql, then try again. (${error.message})`;
  }
  return [error.message, error.details].filter(Boolean).join(" — ");
}

/** Every contact, to match invoices against. Paged, so a book over a thousand
 * is not silently truncated — matching against a truncated list is how a
 * re-import fails to find people it found last time. */
async function loadClients(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string
): Promise<ClientRow[]> {
  const all: ClientRow[] = [];
  const size = 1000;

  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, email, phone, external_id")
      .eq("organization_id", organizationId)
      .range(from, from + size - 1);
    if (error) throw error;

    const page = (data ?? []) as unknown as ClientRow[];
    all.push(...page);
    if (page.length < size) break;
  }
  return all;
}

/** The contact this invoice belongs to. The exporting system's own id first,
 * because it is an exact answer where a name is a guess. */
function matchClient(draft: InvoiceDraft, clients: ClientRow[]): ClientRow | null {
  if (draft.customerExternalId) {
    const exact = clients.find((c) => c.external_id === draft.customerExternalId);
    if (exact) return exact;
  }

  return (
    (findDuplicateCustomer(clients, {
      name: draft.customerName,
      email: draft.customerEmail,
      phone: draft.customerPhone,
    }) as ClientRow | null) ?? null
  );
}
