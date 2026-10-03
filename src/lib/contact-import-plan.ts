/**
 * Deciding what a contact import will do, before any of it is done.
 *
 * The writing used to be interleaved with the deciding: match a row, write it,
 * match the next one, write that. That reads well and is one round trip per
 * row, which for the six hundred and seventy one row export this business
 * actually imports is six hundred and seventy one waits on the network, one
 * after the other, in a server action somebody is watching a spinner for.
 *
 * So the whole file is worked out in memory first, against the contacts as
 * they were read, and comes out as two lists: rows to create and rows to
 * rewrite. Both go to the database in batches.
 *
 * That reordering has one consequence worth being explicit about. Two rows of
 * the same file can be about the same person — the parser only collapses rows
 * that share an identifier, so somebody who appears once with an email and
 * once with a phone gets through as two. Writing row by row handled that by
 * accident, because the second row could see what the first had just written.
 * Here it is handled on purpose: a row that matches something already planned
 * is merged into it, so one contact is still one write and never a duplicate.
 *
 * Pure on purpose. This is the part of an import that is worth being sure
 * about, and being sure about it means being able to test it without a
 * database.
 */

import type { ContactDraft } from "@/lib/contact-import";
import {
  mergeContact,
  type ContactPatch,
  type ExistingContact,
  type IncomingContact,
  type MergeMode,
} from "@/lib/contact-merge";
import { findDuplicateCustomer } from "@/lib/dedupe";

/**
 * A contact as it stands, in as much detail as an import reads or rewrites.
 *
 * Every column an import can touch is here, and it has to be: a rewrite sends
 * the whole row, so a column that was not read is a column that cannot be
 * sent back unchanged.
 */
export interface ExistingContactRow extends ExistingContact {
  id: string;
  organization_id: string;
  name: string;
}

/**
 * A contact this file will add.
 *
 * Database column names because it is written as it stands, apart from the
 * two the person doing the import chooses rather than the file — the contact
 * type and the batch name, which the caller adds.
 */
export interface NewContactRow {
  organization_id: string;
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
  do_not_contact: boolean;
  tags: string[] | null;
}

/**
 * A contact this file will rewrite, whole.
 *
 * Whole because there is no way to send several different single-column
 * updates as one statement, and one statement is the entire point. What makes
 * that safe is that every value in it is either something the merge decided or
 * the value the contact already had — the file's blanks are never in here, so
 * the row cannot lose anything by being written back.
 */
export type ContactUpdateRow = ExistingContactRow;

export interface PlannedUpdate {
  row: ContactUpdateRow;
  /**
   * Whether this rewrite moves the address. A corrected address has to be
   * placed again, or it sits in a column nothing reads while the property —
   * which is what every map and every out-of-area check actually looks at —
   * keeps pointing at the address the import was meant to fix.
   */
  addressChanged: boolean;
}

/** What one row of the file turned out to be, for showing somebody. */
export interface DraftOutcome {
  draft: ContactDraft;
  /** The contact as it was before this row touched it, or null for a new one. */
  before: ExistingContactRow | null;
  patch: ContactPatch;
  outcome: "created" | "updated" | "unchanged";
}

export interface ImportPlan {
  inserts: NewContactRow[];
  updates: PlannedUpdate[];
  /** One per row of the file, in file order. */
  rows: DraftOutcome[];
  /**
   * Counted per contact rather than per row, because that is what the
   * database will do and what somebody checking the number can verify. The
   * two only differ when one file carries the same person twice.
   */
  created: number;
  updated: number;
  unchanged: number;
}

export interface ImportPlanOptions {
  mode: MergeMode;
  organizationId: string;
}

/**
 * A contact being worked on: what it is now, plus what has happened to it.
 *
 * Rows the file will create sit in the same list as the ones already here, so
 * a later row of the same file matches them the same way it matches anybody
 * else. Their id is a placeholder that only has to be unique within the plan.
 */
interface WorkingRow extends ExistingContactRow {
  isNew: boolean;
  changed: boolean;
  addressAtStart: string | null;
}

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
function matchExisting(draft: ContactDraft, rows: WorkingRow[]): WorkingRow | null {
  if (draft.externalId) {
    const byId = rows.find((row) => row.external_id === draft.externalId);
    if (byId) return byId;
  }
  // The ladder is handed the working rows themselves, so what it returns is
  // the row to merge into rather than a copy of it.
  const hit = findDuplicateCustomer(rows, {
    name: draft.name,
    email: draft.email,
    phone: draft.phone,
  });
  return (hit as WorkingRow | null) ?? null;
}

/** The columns of a working row, without the bookkeeping the caller must not send. */
function toContactRow(row: WorkingRow): ExistingContactRow {
  return {
    id: row.id,
    organization_id: row.organization_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    external_id: row.external_id,
    import_address: row.import_address,
    notes: row.notes,
    source: row.source,
    pipeline: row.pipeline,
    pipeline_stage: row.pipeline_stage,
    opportunity_value: row.opportunity_value,
    do_not_contact: row.do_not_contact,
    tags: row.tags,
  };
}

/** The same, without the placeholder id — the database hands out the real one. */
function toNewRow(row: WorkingRow): NewContactRow {
  return {
    organization_id: row.organization_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    external_id: row.external_id,
    import_address: row.import_address,
    notes: row.notes,
    source: row.source,
    pipeline: row.pipeline,
    pipeline_stage: row.pipeline_stage,
    opportunity_value: row.opportunity_value,
    do_not_contact: row.do_not_contact,
    tags: row.tags,
  };
}

export function planContactImport(
  existing: ExistingContactRow[],
  drafts: ContactDraft[],
  options: ImportPlanOptions
): ImportPlan {
  const working: WorkingRow[] = existing.map((row) => ({
    ...row,
    isNew: false,
    changed: false,
    addressAtStart: row.import_address,
  }));

  const rows: DraftOutcome[] = [];
  let unchanged = 0;

  for (const draft of drafts) {
    const match = matchExisting(draft, working);

    if (!match) {
      working.push({
        id: `planned:${working.length}`,
        organization_id: options.organizationId,
        name: draft.name,
        email: draft.email,
        phone: draft.phone,
        external_id: draft.externalId,
        import_address: draft.address,
        notes: draft.notes,
        source: draft.source,
        pipeline: draft.pipeline,
        pipeline_stage: draft.pipelineStage,
        opportunity_value: draft.opportunityValue,
        do_not_contact: draft.doNotContact,
        tags: draft.tags.length > 0 ? draft.tags : null,
        isNew: true,
        changed: true,
        addressAtStart: draft.address,
      });
      rows.push({ draft, before: null, patch: {}, outcome: "created" });
      continue;
    }

    const before = toContactRow(match);
    const patch = mergeContact(match, asIncoming(draft), options.mode);

    if (Object.keys(patch).length === 0) {
      unchanged++;
      rows.push({ draft, before: match.isNew ? null : before, patch, outcome: "unchanged" });
      continue;
    }

    // Applied to the working copy, not to the database, so the rest of the
    // file sees this person as they will be rather than as they were.
    Object.assign(match, patch);
    match.changed = true;
    rows.push({
      draft,
      before: match.isNew ? null : before,
      patch,
      // A row that merged into something this same file is adding is still
      // somebody being added, not somebody being updated.
      outcome: match.isNew ? "created" : "updated",
    });
  }

  const inserts = working.filter((row) => row.isNew).map(toNewRow);
  const updates = working
    .filter((row) => !row.isNew && row.changed)
    .map((row) => ({
      row: toContactRow(row),
      addressChanged: row.import_address !== row.addressAtStart,
    }));

  return {
    inserts,
    updates,
    rows,
    created: inserts.length,
    updated: updates.length,
    unchanged,
  };
}
