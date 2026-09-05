"use server";

import { revalidatePath } from "next/cache";

import { describeDbError } from "@/lib/setup-errors";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { chunk } from "@/lib/chunk";
import { parseContactCsv } from "@/lib/contact-import";
import { isContactType, type ContactType } from "@/lib/contact-types";
import { describeChanges, type MergeMode } from "@/lib/contact-merge";
import {
  planContactImport,
  type ContactUpdateRow,
  type ExistingContactRow,
  type ImportPlan,
} from "@/lib/contact-import-plan";

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

interface DbError {
  message?: string;
  code?: string;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** A rewrite, plus the two columns only a contact whose address moved carries. */
type ContactWrite = ContactUpdateRow & { geocode_attempted_at?: null; geocode_error?: null };

/**
 * How many rows go in one statement.
 *
 * Big enough that the six hundred odd row export this business imports is two
 * statements rather than six hundred, small enough that no single request
 * carries a payload measured in megabytes or holds a transaction open long
 * enough to be noticed by anybody else writing to the same table.
 */
const WRITE_CHUNK = 500;

/**
 * PostgREST answers with a page rather than everything, and silently: a
 * thousand-row default means the thousand-and-first contact simply is not in
 * the reply. Matching against a list that is missing people is how a re-import
 * creates a second copy of everybody it could not see, so the book is read a
 * page at a time until a page comes back empty. Asking for one more page than
 * there are is a round trip nobody notices, and it is the only ending that
 * does not assume the server hands back as many rows as it was asked for.
 */
const READ_PAGE = 1000;

/**
 * Everything a re-import might fill in.
 *
 * Wider than it looks like it needs to be, because "fill the blanks" can only
 * be decided by knowing which are blank, and because a rewrite sends the whole
 * row — a column that was not read cannot be sent back unchanged. Importing
 * the same export twice — once without a column, once with it — is a normal
 * thing to do and has to work, so every field an import can write is read
 * back here.
 *
 * The error is returned rather than swallowed. A failed read used to come back
 * as an empty list, which does not look like a failure to anything downstream:
 * it looks like an empty contact book, and the import obligingly adds everyone
 * a second time.
 */
async function loadExisting(
  supabase: Supabase
): Promise<{ rows: ExistingContactRow[]; error: DbError | null }> {
  const rows: ExistingContactRow[] = [];

  for (let from = 0; ; ) {
    const { data, error } = await supabase
      .from("customers")
      .select(
        "id, organization_id, name, email, phone, external_id, import_address, notes, source, pipeline, pipeline_stage, opportunity_value, do_not_contact, tags"
      )
      // Paging without an order is paging over an order the database is free
      // to change between requests, which drops and repeats rows.
      .order("id")
      .range(from, from + READ_PAGE - 1);

    if (error) return { rows, error };
    const page = (data ?? []) as unknown as ExistingContactRow[];
    if (page.length === 0) return { rows, error: null };
    rows.push(...page);
    from += page.length;
  }
}

/**
 * What this file would do, without doing it.
 *
 * A contact import is the kind of thing somebody runs once with three thousand
 * rows and then spends an afternoon undoing. Showing the counts and the first
 * few parsed rows first costs one extra tap and catches a mis-mapped column
 * before it is three thousand mistakes.
 *
 * Worked out by the same planner that does the importing, so the numbers here
 * are the numbers that will happen rather than a second opinion about them.
 */
export async function previewContactImport(
  csvText: string,
  // Updating is the default: a re-import is nearly always a corrected export
  // of people already here, and filling blanks cannot correct anything.
  mode: MergeMode = "overwrite"
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

    const [supabase, organizationId] = await Promise.all([createClient(), getCurrentOrganizationId()]);
    const existing = await loadExisting(supabase);
    if (existing.error) return { ok: false, message: describeDbError(existing.error) };

    const plan = planContactImport(existing.rows, report.drafts, { mode, organizationId });

    let gainingAddress = 0;
    let correcting = 0;
    const corrections: ImportPreview["corrections"] = [];
    const sample: ImportPreview["sample"] = [];

    for (const row of plan.rows) {
      if (row.before) {
        if (row.patch.import_address) gainingAddress++;
        const changed = describeChanges(row.before, row.patch);
        if (changed.length > 0) {
          correcting++;
          for (const change of changed) {
            if (corrections.length < 5) corrections.push({ name: row.draft.name, ...change });
          }
        }
      } else if (row.draft.address) {
        gainingAddress++;
      }

      if (sample.length < 5) {
        sample.push({
          name: row.draft.name,
          email: row.draft.email,
          phone: row.draft.phone,
          existing: row.before !== null,
        });
      }
    }

    return {
      ok: true,
      creating: plan.created,
      updating: plan.updated,
      unchanged: plan.unchanged,
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
 * Adds the people this file does not have yet.
 *
 * Rows carrying the CRM's own id go in as an upsert onto the unique index over
 * (organization_id, external_id), so the same export landing twice — two tabs,
 * a double tap, a second import while the first is still running — cannot
 * produce two of the same person. The conflict is left to do nothing rather
 * than to update, and that is deliberate: an update here would write this
 * file's blanks over whatever the row that beat us to it already holds, and a
 * blank column is never a statement that a value is gone. The file's own
 * corrections are not lost by that, they simply land on the next run, when the
 * contact is visible to the matching pass and goes down the rewrite path.
 *
 * Rows with no id from the CRM have nothing to conflict on and go in plainly.
 */
async function insertNew(
  supabase: Supabase,
  plan: ImportPlan,
  type: ContactType,
  batch: string
): Promise<{ created: number; error: DbError | null }> {
  const rows = plan.inserts.map((row) => ({ ...row, contact_type: type, import_batch: batch }));
  const identified = rows.filter((row) => row.external_id);
  const anonymous = rows.filter((row) => !row.external_id);
  let created = 0;

  for (const group of chunk(identified, WRITE_CHUNK)) {
    const { data, error } = await supabase
      .from("customers")
      .upsert(group, { onConflict: "organization_id,external_id", ignoreDuplicates: true })
      .select("id");
    if (error) return { created, error };
    // Only rows that were actually inserted come back, so a contact somebody
    // else added while this ran is not counted as one of ours.
    created += data?.length ?? 0;
  }

  for (const group of chunk(anonymous, WRITE_CHUNK)) {
    const { data, error } = await supabase.from("customers").insert(group).select("id");
    if (error) return { created, error };
    created += data?.length ?? 0;
  }

  return { created, error: null };
}

/**
 * Rewrites the people this file has something new for.
 *
 * Sent as an upsert onto the primary key, which is the only way to put several
 * differing rows into one statement. What makes writing a whole row safe is
 * what the planner put in it: every value is either something the merge
 * decided or the value the contact already had. The file's blanks are not in
 * there, so a column the export left out cannot clear anything.
 *
 * The two shapes are chunked separately because a batch has to carry the same
 * keys on every row, and only the contacts whose address actually moved get
 * their geocoding cleared — clearing it for the rest would send the whole book
 * back through the geocoder on every import.
 */
async function rewriteMatched(
  supabase: Supabase,
  plan: ImportPlan
): Promise<{ updated: number; error: DbError | null }> {
  const readdressed = plan.updates
    .filter((update) => update.addressChanged)
    .map((update) => ({ ...update.row, geocode_attempted_at: null, geocode_error: null }));
  const rest = plan.updates.filter((update) => !update.addressChanged).map((update) => update.row);

  let updated = 0;
  const groups: ContactWrite[][] = [...chunk(readdressed, WRITE_CHUNK), ...chunk(rest, WRITE_CHUNK)];

  for (const group of groups) {
    const { data, error } = await supabase
      .from("customers")
      .upsert(group, { onConflict: "id" })
      .select("id");
    if (error) return { updated, error };
    updated += data?.length ?? 0;
  }

  return { updated, error: null };
}

/**
 * Why a write failed, in words somebody can act on.
 *
 * Postgres cannot use a partial unique index for an upsert unless the
 * statement repeats its condition, and PostgREST has no way to say one — so
 * the index the import needs is the plain one that migration adds. Without it
 * the error is "no unique or exclusion constraint matching the ON CONFLICT
 * specification", which is true and tells nobody what to do.
 */
function describeImportError(error: DbError): string {
  if (error.code === "42P10") {
    return "This import needs its database migration. In Supabase's SQL Editor, run supabase/migrations/0136_contact_import_conflict_target.sql, then reload. Database setup has a copy button.";
  }
  return describeDbError(error);
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
 *
 * The whole file is decided first and then written in batches. Six hundred and
 * seventy one rows is two statements, not six hundred and seventy one, and the
 * counts below are counted from what the database said it did rather than from
 * what we hoped it would.
 */
export async function importContacts(
  csvText: string,
  contactType: string,
  batchName: string,
  mode: MergeMode = "overwrite"
): Promise<ImportResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };
    if (!isContactType(contactType)) return { ok: false, message: "Pick what kind of contacts these are." };

    const report = parseContactCsv(csvText);
    if (report.drafts.length === 0) {
      return { ok: false, message: report.skipped[0]?.reason ?? "Nothing to import." };
    }

    const [supabase, organizationId] = await Promise.all([createClient(), getCurrentOrganizationId()]);
    const existing = await loadExisting(supabase);
    if (existing.error) return { ok: false, message: describeDbError(existing.error) };

    const batch = batchName.trim() || `Import ${new Date().toLocaleDateString()}`;
    const type = contactType as ContactType;
    const plan = planContactImport(existing.rows, report.drafts, { mode, organizationId });

    const added = await insertNew(supabase, plan, type, batch);
    if (added.error) return { ok: false, message: describeImportError(added.error) };

    const rewritten = await rewriteMatched(supabase, plan);
    if (rewritten.error) return { ok: false, message: describeImportError(rewritten.error) };

    revalidatePath("/contacts");
    return {
      ok: true,
      created: added.created,
      updated: rewritten.updated,
      // Filled-in and left-alone counted separately, so a re-import that was
      // supposed to add something and added nothing says so instead of
      // reporting a cheerful number that means "I did nothing".
      message: [
        added.created > 0 ? `${added.created} added` : null,
        rewritten.updated > 0 ? `${rewritten.updated} filled in` : null,
        plan.unchanged > 0 ? `${plan.unchanged} already complete` : null,
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
