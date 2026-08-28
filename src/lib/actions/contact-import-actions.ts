"use server";

import { revalidatePath } from "next/cache";

import { describeDbError } from "@/lib/setup-errors";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { findDuplicateCustomer } from "@/lib/dedupe";
import { parseContactCsv, type ContactDraft } from "@/lib/contact-import";
import { isContactType, type ContactType } from "@/lib/contact-types";
import {
  describeChanges,
  mergeContact,
  type ExistingContact,
  type IncomingContact,
  type MergeMode,
} from "@/lib/contact-merge";

export interface ImportPreview {
  ok: true;
  /** Rows that would create a new contact. */
  creating: number;
  /** Rows that match somebody already here and would gain something. */
  updating: number;
  /** Matched, but the file has nothing they are missing. */
  unchanged: number;
  /** Of the updates, how many gain an address — the thing somebody re-imports
   * for, and the thing worth confirming before they commit to three thousand
   * rows a second time. */
  gainingAddress: number;
  /**
   * Contacts where the file disagrees with what is here and would replace it.
   * Zero in fill mode by definition, and the number to look hardest at in
   * overwrite mode.
   */
  correcting: number;
  /** The first few real replacements, with both values, so a mis-mapped
   * column is caught before it is three thousand of them. */
  corrections: { name: string; label: string; from: string; to: string }[];
  optedOut: number;
  skipped: { row: number; reason: string }[];
  unmatchedHeaders: string[];
  /** The first few, so somebody can see the parser read their file correctly
   * before they commit thousands of rows to it. */
  sample: { name: string; email: string | null; phone: string | null; existing: boolean }[];
}

export type PreviewResult = ImportPreview | { ok: false; message: string };
export type ImportResult =
  | { ok: true; created: number; updated: number; message: string }
  | { ok: false; message: string };

interface ExistingRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  external_id: string | null;
  import_address: string | null;
  notes: string | null;
  source: string | null;
  pipeline: string | null;
  pipeline_stage: string | null;
  opportunity_value: number | null;
}

/**
 * Everything a re-import might fill in.
 *
 * Wider than it looks like it needs to be, because "fill the blanks" can only
 * be decided by knowing which are blank. Importing the same export twice —
 * once without a column, once with it — is a normal thing to do and has to
 * work, so every field an import can write is read back here.
 */
async function loadExisting(): Promise<ExistingRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select(
      "id, name, email, phone, external_id, import_address, notes, source, pipeline, pipeline_stage, opportunity_value"
    );
  return (data ?? []) as unknown as ExistingRow[];
}

/**
 * What a second import would add to somebody already here.
 *
 * Blanks only, always. An import must never overwrite a phone number or a
 * spelling the office corrected by hand — but a field that is empty has
 * nothing to protect, and leaving it empty when the file has the answer is the
 * bug that makes people re-import and wonder why nothing happened.
 *
 * The opt-out is the one exception, and it only ever moves towards silence.
 */
/** The import's own row shape, as the merge module wants it. */
function asIncoming(draft: ContactDraft): IncomingContact {
  return {
    email: draft.email,
    phone: draft.phone,
    externalId: draft.externalId,
    address: draft.address,
    notes: draft.notes,
    source: draft.source,
    pipeline: draft.pipeline,
    pipelineStage: draft.pipelineStage,
    opportunityValue: draft.opportunityValue,
    doNotContact: draft.doNotContact,
    tags: draft.tags,
  };
}

/**
 * Matches an incoming row against what is already here.
 *
 * The CRM's own id first, because it is the only identifier that is actually
 * an identifier. Then the same email/phone/name ladder the booking form uses,
 * so a contact typed in by hand last year and exported from the CRM today
 * lands on one record rather than two.
 */
function matchExisting(draft: ContactDraft, existing: ExistingRow[]): ExistingRow | null {
  if (draft.externalId) {
    const byId = existing.find((c) => c.external_id === draft.externalId);
    if (byId) return byId;
  }
  return (
    (findDuplicateCustomer(existing, {
      name: draft.name,
      email: draft.email,
      phone: draft.phone,
    }) as ExistingRow | null) ?? null
  );
}

/**
 * What this file would do, without doing it.
 *
 * A contact import is the kind of thing somebody runs once with three thousand
 * rows and then spends an afternoon undoing. Showing the counts and the first
 * few parsed rows first costs one extra tap and catches a mis-mapped column
 * before it is three thousand mistakes.
 */
export async function previewContactImport(
  csvText: string,
  mode: MergeMode = "fill"
): Promise<PreviewResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };
    if (!csvText.trim()) return { ok: false, message: "Paste or upload a file first." };

    const report = parseContactCsv(csvText);
    if (report.drafts.length === 0) {
      return {
        ok: false,
        message: report.skipped[0]?.reason ?? "Nothing in that file could be read as a contact.",
      };
    }

    const existing = await loadExisting();
    let creating = 0;
    let updating = 0;
    let unchanged = 0;
    let gainingAddress = 0;
    let correcting = 0;
    const corrections: ImportPreview["corrections"] = [];
    const sample: ImportPreview["sample"] = [];

    for (const draft of report.drafts) {
      const match = matchExisting(draft, existing);
      if (match) {
        const patch = mergeContact(match as ExistingContact, asIncoming(draft), mode);
        if (Object.keys(patch).length > 0) updating++;
        else unchanged++;
        if (patch.import_address) gainingAddress++;

        const changed = describeChanges(match as ExistingContact, patch);
        if (changed.length > 0) {
          correcting++;
          for (const change of changed) {
            if (corrections.length < 5) corrections.push({ name: draft.name, ...change });
          }
        }
      } else {
        creating++;
        if (draft.address) gainingAddress++;
      }
      if (sample.length < 5) {
        sample.push({
          name: draft.name,
          email: draft.email,
          phone: draft.phone,
          existing: Boolean(match),
        });
      }
    }

    return {
      ok: true,
      creating,
      updating,
      unchanged,
      gainingAddress,
      correcting,
      corrections,
      optedOut: report.drafts.filter((d) => d.doNotContact).length,
      skipped: report.skipped,
      unmatchedHeaders: report.unmatchedHeaders,
      sample,
    };
  } catch (err) {
    console.error("previewContactImport failed:", err);
    return { ok: false, message: "Couldn't read that file." };
  }
}

/**
 * Writes the file in.
 *
 * The type is chosen by whoever is importing rather than guessed: a row saying
 * "Bob's Tree Service" is obviously a subcontractor to a person and
 * indistinguishable from a client to a parser.
 *
 * Existing contacts have their blanks filled and are otherwise left alone. An
 * import must never overwrite a phone number or a spelling the office already
 * corrected by hand — except the opt-out flag, which only ever moves towards
 * "do not contact", because the cost of dropping one is contacting somebody
 * who asked us not to.
 */
export async function importContacts(
  csvText: string,
  contactType: string,
  batchName: string,
  mode: MergeMode = "fill"
): Promise<ImportResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };
    if (!isContactType(contactType)) return { ok: false, message: "Pick what kind of contacts these are." };

    const report = parseContactCsv(csvText);
    if (report.drafts.length === 0) {
      return { ok: false, message: report.skipped[0]?.reason ?? "Nothing to import." };
    }

    const [supabase, organizationId] = await Promise.all([createClient(), getCurrentOrganizationId()]);
    const existing = await loadExisting();

    const batch = batchName.trim() || `Import ${new Date().toLocaleDateString()}`;
    const type = contactType as ContactType;

    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const draft of report.drafts) {
      const match = matchExisting(draft, existing);

      if (match) {
        const patch = mergeContact(match as ExistingContact, asIncoming(draft), mode);
        if (Object.keys(patch).length > 0) {
          await supabase.from("customers").update(patch).eq("id", match.id);
          updated++;
        } else {
          unchanged++;
        }
        continue;
      }

      const { data: inserted, error } = await supabase
        .from("customers")
        .insert({
          organization_id: organizationId,
          name: draft.name,
          email: draft.email,
          phone: draft.phone,
          notes: draft.notes,
          contact_type: type,
          source: draft.source,
          import_batch: batch,
          external_id: draft.externalId,
          do_not_contact: draft.doNotContact,
          tags: draft.tags.length > 0 ? draft.tags : null,
          import_address: draft.address,
          pipeline: draft.pipeline,
          pipeline_stage: draft.pipelineStage,
          opportunity_value: draft.opportunityValue,
        })
        .select("id, name, email, phone, external_id")
        .single();

      if (error) return { ok: false, message: describeDbError(error) };
      if (inserted) {
        created++;
        // Added to the in-memory list so two rows for the same person later in
        // the same file match each other rather than both inserting.
        existing.push(inserted as unknown as ExistingRow);
      }
    }

    revalidatePath("/contacts");
    return {
      ok: true,
      created,
      updated,
      // Filled-in and left-alone counted separately, so a re-import that was
      // supposed to add something and added nothing says so instead of
      // reporting a cheerful number that means "I did nothing".
      message: [
        created > 0 ? `${created} added` : null,
        updated > 0 ? `${updated} filled in` : null,
        unchanged > 0 ? `${unchanged} already complete` : null,
        report.skipped.length > 0 ? `${report.skipped.length} skipped` : null,
      ]
        .filter(Boolean)
        .join(", ") + ".",
    };
  } catch (err) {
    console.error("importContacts failed:", err);
    return { ok: false, message: "Couldn't finish that import." };
  }
}
