"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { revalidateJobViews } from "@/lib/revalidate-job";
import {
  applyZoneEdit,
  describeEvaluationChange,
  manualZone,
  removedZoneNames,
  type EditableZone,
  type ProposalFollowThrough,
  type ZoneEdit,
} from "@/lib/evaluation-edit";
import { applyProposalTrim } from "@/lib/data/proposal-trim-apply";

export type EvaluationEditResponse =
  | { ok: true; changes: string[]; proposal: ProposalFollowThrough }
  | { ok: false; message: string };

export interface ManualZoneInput {
  id: string;
  name: string;
  serviceTypeId: string | null;
  length: string;
  width: string;
  linear: boolean;
  notes: string;
  color: string;
}

/**
 * Saving changes somebody typed into an evaluation.
 *
 * Writes the zones back onto the same design row, so the site map, the
 * measurements and anything priced from them all move together — there is
 * one evaluation, not a second corrected copy of it.
 *
 * The list of changes is recorded before the design is written. A
 * measurement that quietly differs from what was measured on the day, with
 * nothing saying who changed it, is the situation this record exists for.
 *
 * A removed area is carried through to the proposal in the same save. It
 * used to stop at the design, and the proposal kept listing an area the
 * client had been told was gone until somebody remembered to rebuild it.
 * Measurements still need a rebuild, because a new size is a new price the
 * rate card has to work out; a removal is only a subtraction, and the trim
 * already knows how to do that and how to tell the client.
 */
export async function saveEvaluationChanges(input: {
  jobId: string;
  edits: ZoneEdit[];
  removeZoneIds: string[];
  addZones: ManualZoneInput[];
  requestedVia?: string;
  note?: string;
}): Promise<EvaluationEditResponse> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };

    const supabase = await createClient();
    const { data: design, error } = await supabase
      .from("canvas_designs")
      .select("id, zones")
      .eq("job_id", input.jobId)
      .maybeSingle();
    if (error) return { ok: false, message: error.message };
    if (!design) return { ok: false, message: "This job has no site map yet." };

    const before = ((design.zones ?? []) as unknown as EditableZone[]) ?? [];
    const editById = new Map(input.edits.map((e) => [e.id, e]));
    const removing = new Set(input.removeZoneIds);

    const after: EditableZone[] = before
      .filter((zone) => !removing.has(zone.id))
      .map((zone) => {
        const edit = editById.get(zone.id);
        return edit ? applyZoneEdit(zone, edit) : zone;
      });

    for (const add of input.addZones) after.push(manualZone(add));

    const changes = describeEvaluationChange({ before, after });
    if (changes.length === 0 && !input.note?.trim()) {
      return { ok: false, message: "Nothing changed yet." };
    }

    const organizationId = await getCurrentOrganizationId();
    const { error: logError } = await supabase.from("evaluation_edits").insert({
      job_id: input.jobId,
      organization_id: organizationId,
      edited_by: profile.id,
      edited_by_name: profile.full_name || profile.email,
      changes,
      requested_via: input.requestedVia || null,
      note: input.note?.trim() || null,
    });
    // Recorded first, on purpose.
    if (logError) return { ok: false, message: logError.message };

    const { error: saveError } = await supabase
      .from("canvas_designs")
      .update({ zones: after })
      .eq("id", design.id);
    if (saveError) return { ok: false, message: saveError.message };

    revalidateJobViews(input.jobId);

    const proposal = await followRemovalsThrough({
      jobId: input.jobId,
      names: removedZoneNames(before, input.removeZoneIds),
      note: input.note,
      requestedVia: input.requestedVia,
      editedBy: { id: profile.id, name: profile.full_name || profile.email },
    });

    return { ok: true, changes, proposal };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't save that." };
  }
}

/**
 * The same removal, on the proposal.
 *
 * The client is told only when the proposal has actually been sent: a draft
 * nobody has seen has nobody to tell, and an accepted one is a price they
 * agreed to, which the trim refuses to move and this reports back rather
 * than hides.
 */
async function followRemovalsThrough(input: {
  jobId: string;
  names: string[];
  note?: string;
  requestedVia?: string;
  editedBy: { id: string; name: string };
}): Promise<ProposalFollowThrough> {
  if (input.names.length === 0) return { kind: "none" };
  try {
    const outcome = await applyProposalTrim({
      jobId: input.jobId,
      removeZones: input.names,
      removeLines: [],
      note: input.note,
      requestedVia: input.requestedVia,
      // Decided inside: the trim knows the status. Sent proposals are told,
      // drafts are not, and it reports which it did.
      notifyClient: true,
      requireRemoval: true,
      editedBy: input.editedBy,
    });
    if (outcome.ok) {
      return { kind: "trimmed", removed: outcome.removedZones, newTotalCents: outcome.newTotalCents, notified: outcome.notified };
    }
    if (outcome.reason === "accepted") return { kind: "accepted", removed: input.names.length };
    if (outcome.reason === "missing") return { kind: "none" };
    return { kind: "not_on_proposal", removed: input.names.length };
  } catch {
    // The evaluation is already saved and recorded. A proposal that could
    // not be reached is reported as untouched rather than failing the save.
    return { kind: "not_on_proposal", removed: input.names.length };
  }
}
