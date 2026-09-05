"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { revalidateJobViews } from "@/lib/revalidate-job";
import {
  applyZoneEdit,
  describeEvaluationChange,
  manualZone,
  type EditableZone,
  type ZoneEdit,
} from "@/lib/evaluation-edit";

export type EvaluationEditResponse =
  | { ok: true; changes: string[] }
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
    return { ok: true, changes };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't save that." };
  }
}
