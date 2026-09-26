/**
 * What an import does to somebody who is already here.
 *
 * There are two honest answers and the difference matters enormously.
 *
 * Filling blanks is safe: it only ever adds what is missing, so nothing
 * anybody typed here can be lost. It is also useless for the case somebody
 * actually re-imports for. If a contact already carries a wrong address, a
 * corrected export changes nothing, because the field was not blank, it was
 * wrong.
 *
 * So the other mode lets the export win where the two disagree. That is the
 * one worth being careful about, and the care is a single rule: an empty
 * column never overwrites anything. A CRM export with the phone column left
 * out is not a statement that nobody has a phone number, and treating it as
 * one wipes the business's contact book in a single click.
 */

export type MergeMode =
  /** Only add what is missing. Nothing here can be lost. */
  | "fill"
  /** The file wins where the two disagree, but a blank never wins. */
  | "overwrite";

export interface ExistingContact {
  email: string | null;
  phone: string | null;
  external_id: string | null;
  import_address: string | null;
  notes: string | null;
  source: string | null;
  pipeline: string | null;
  pipeline_stage: string | null;
  opportunity_value: number | null;
  /** Read as well as written, so a re-import of the same export reports the
   * people it left exactly as they were rather than counting them as changed
   * and writing them again. */
  do_not_contact: boolean;
  tags: string[] | null;
}

export interface IncomingContact {
  email: string | null;
  phone: string | null;
  externalId: string | null;
  address: string | null;
  notes: string | null;
  source: string | null;
  pipeline: string | null;
  pipelineStage: string | null;
  opportunityValue: number | null;
  doNotContact: boolean;
  tags: string[];
}

export interface ContactPatch {
  email?: string;
  phone?: string;
  external_id?: string;
  import_address?: string;
  notes?: string;
  source?: string;
  pipeline?: string;
  pipeline_stage?: string;
  opportunity_value?: number;
  do_not_contact?: boolean;
  tags?: string[];
}

/** The text fields, paired up so both modes walk the same list. */
const TEXT_FIELDS: {
  column: keyof ContactPatch;
  existing: keyof ExistingContact;
  incoming: keyof IncomingContact;
  label: string;
}[] = [
  { column: "email", existing: "email", incoming: "email", label: "Email" },
  { column: "phone", existing: "phone", incoming: "phone", label: "Phone" },
  { column: "external_id", existing: "external_id", incoming: "externalId", label: "CRM id" },
  { column: "import_address", existing: "import_address", incoming: "address", label: "Address" },
  { column: "notes", existing: "notes", incoming: "notes", label: "Notes" },
  { column: "source", existing: "source", incoming: "source", label: "Source" },
  { column: "pipeline", existing: "pipeline", incoming: "pipeline", label: "Pipeline" },
  {
    column: "pipeline_stage",
    existing: "pipeline_stage",
    incoming: "pipelineStage",
    label: "Pipeline stage",
  },
];

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * The changes an import would make to one existing contact.
 *
 * Empty patch means the file has nothing this record needs, which is the
 * normal outcome for most rows of a re-import and is worth reporting as
 * "unchanged" rather than as an update that did nothing.
 */
export function mergeContact(
  existing: ExistingContact,
  incoming: IncomingContact,
  mode: MergeMode
): ContactPatch {
  const patch: ContactPatch = {};

  for (const field of TEXT_FIELDS) {
    const next = text(incoming[field.incoming]);
    // The rule the whole thing rests on. A column the export left out is not
    // a statement that the value is gone.
    if (!next) continue;

    const current = text(existing[field.existing]);
    if (!current) {
      (patch as Record<string, unknown>)[field.column] = next;
      continue;
    }
    if (mode === "overwrite" && current !== next) {
      (patch as Record<string, unknown>)[field.column] = next;
    }
  }

  if (incoming.opportunityValue != null) {
    if (existing.opportunity_value == null) {
      patch.opportunity_value = incoming.opportunityValue;
    } else if (mode === "overwrite" && existing.opportunity_value !== incoming.opportunityValue) {
      patch.opportunity_value = incoming.opportunityValue;
    }
  }

  // Only ever towards silence, in either mode. Somebody who asked not to be
  // contacted does not stop having asked because a later export forgot.
  if (incoming.doNotContact && !existing.do_not_contact) patch.do_not_contact = true;
  if (incoming.tags.length > 0 && !sameTags(existing.tags, incoming.tags)) patch.tags = incoming.tags;

  return patch;
}

/**
 * Whether the file's tags are the ones already filed here.
 *
 * Order counts, because a CRM exports its tags in a stable order and the
 * cheap comparison is right for every case that actually happens. The point
 * is only to keep an unchanged row out of the write: a patch that sets a
 * value to what it already is costs a statement and reports itself as an
 * update, which makes the import's own counts untrustworthy.
 */
function sameTags(existing: string[] | null, incoming: string[]): boolean {
  if (!existing || existing.length !== incoming.length) return false;
  return existing.every((tag, i) => tag === incoming[i]);
}

export interface FieldChange {
  label: string;
  from: string;
  to: string;
}

/**
 * The fields this patch would actually change, with both values.
 *
 * Only genuine replacements: filling a blank is not something anybody needs
 * to review, but having an address rewritten is.
 */
export function describeChanges(existing: ExistingContact, patch: ContactPatch): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of TEXT_FIELDS) {
    const next = patch[field.column];
    if (typeof next !== "string") continue;
    const current = text(existing[field.existing]);
    if (!current || current === next) continue;
    changes.push({ label: field.label, from: current, to: next });
  }
  return changes;
}

/** What the button should say, so nobody presses it expecting the other one. */
export function modeLabel(mode: MergeMode): string {
  return mode === "overwrite"
    ? "Update the ones we already have"
    : "Only add people we have never seen";
}

export function modeBlurb(mode: MergeMode): string {
  return mode === "overwrite"
    ? "Where the file and a contact disagree, the file wins. A column left blank in the file never clears anything here."
    : "Nothing already on a contact is touched. Use this unless you are correcting bad data.";
}
