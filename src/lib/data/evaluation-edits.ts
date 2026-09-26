import { createClient } from "@/lib/supabase/server";
import type { EvaluationEditRecord } from "@/components/job/evaluation-changes-panel";

/**
 * Changes typed into an evaluation after the walk, newest first.
 *
 * Tolerated rather than required: before migration 0134 the table does not
 * exist, and a job page that refuses to load because nothing has been changed
 * yet is worse than one showing no history.
 */
export async function listEvaluationEdits(jobId: string): Promise<EvaluationEditRecord[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("evaluation_edits")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false });

    return ((data ?? []) as unknown as {
      id: string;
      created_at: string;
      edited_by_name: string | null;
      changes: string[];
      requested_via: string | null;
      note: string | null;
    }[]).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      editedByName: row.edited_by_name,
      changes: row.changes ?? [],
      requestedVia: row.requested_via,
      note: row.note,
    }));
  } catch {
    return [];
  }
}
