import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import {
  beforesFromZones,
  notYetAdopted,
  type ZoneLike,
} from "@/lib/evaluation-befores";

/**
 * Adopts the evaluation's zone photos as the job's "before" pictures.
 *
 * Somebody already photographed that garden before anything was touched.
 * Asking the crew for a second before on the day is asking for a photograph
 * of work that has already started, and when they forget, a job with a folder
 * full of before pictures produces no before-and-after at all.
 *
 * Idempotent: the destination path is worked out from the source, so running
 * it again finds everything already there and does nothing. An evaluation
 * submitted, corrected and submitted again does not end up with three copies
 * of every photo.
 *
 * Best-effort by design. A photo that will not copy must not stop an
 * evaluation being submitted.
 */
export interface AdoptionResult {
  /** How many were copied over. */
  adopted: number;
  /** How many were there to try. Zero means the evaluation had no zone photos. */
  attempted: number;
  /** Why the last failure failed, if any did. Reported rather than swallowed:
   * "nothing to do" and "everything failed" look identical from a count. */
  lastError: string | null;
}

export async function adoptEvaluationPhotosAsBefores(jobId: string): Promise<AdoptionResult> {
  const supabase = await createClient();

  const { data: design } = await supabase
    .from("canvas_designs")
    .select("zones")
    .eq("job_id", jobId)
    .maybeSingle();

  if (!design) return { adopted: 0, attempted: 0, lastError: null };

  const candidates = beforesFromZones(jobId, (design.zones ?? []) as unknown as ZoneLike[]);
  if (candidates.length === 0) return { adopted: 0, attempted: 0, lastError: null };

  const { data: existing } = await supabase
    .from("job_photos")
    .select("path")
    .eq("job_id", jobId);

  const todo = notYetAdopted(
    candidates,
    ((existing ?? []) as { path: string }[]).map((row) => row.path)
  );
  if (todo.length === 0) return { adopted: 0, attempted: 0, lastError: null };

  const [profile, organizationId] = await Promise.all([
    getCurrentProfile().catch(() => null),
    getCurrentOrganizationId(),
  ]);

  let adopted = 0;
  let lastError: string | null = null;

  for (const candidate of todo) {
    try {
      // The two buckets are separate — one is public working storage for the
      // canvas, the other is the private record of the job — so this is a
      // real copy rather than a rename.
      const { data: blob, error: downloadError } = await supabase.storage
        .from("canvas-images")
        .download(candidate.sourcePath);
      if (downloadError || !blob) {
        lastError = downloadError?.message ?? "the photo could not be read";
        continue;
      }

      const { error: uploadError } = await supabase.storage
        .from("job-photos")
        .upload(candidate.destPath, blob, { upsert: true, contentType: blob.type || "image/jpeg" });
      if (uploadError) {
        lastError = uploadError.message;
        continue;
      }

      const { error: insertError } = await supabase.from("job_photos").insert({
        job_id: jobId,
        organization_id: organizationId,
        path: candidate.destPath,
        kind: "before",
        zone_id: candidate.zoneId,
        zone_name: candidate.zoneName,
        caption: `From the evaluation — ${candidate.zoneName}`,
        uploaded_by: profile?.id ?? null,
      });
      if (insertError) {
        lastError = insertError.message;
        continue;
      }

      adopted++;
    } catch (err) {
      console.error("adopting an evaluation photo failed:", err);
      lastError = err instanceof Error ? err.message : "something went wrong";
    }
  }

  return { adopted, attempted: todo.length, lastError };
}
