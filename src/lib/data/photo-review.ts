import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import type { PhotoMark } from "@/lib/photo-review";

/** Every mark on this job's photos, resolved or not. */
export async function listPhotoMarks(jobId: string): Promise<PhotoMark[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("job_photo_marks")
    .select(
      "id, photo_id, x, y, note, created_at, resolved_at, author:created_by(full_name, email), resolver:resolved_by(full_name, email)"
    )
    .eq("job_id", jobId)
    .order("created_at");

  if (isMissingTable(error) || error) return [];

  return ((data ?? []) as unknown as {
    id: string;
    photo_id: string;
    x: number;
    y: number;
    note: string;
    created_at: string;
    resolved_at: string | null;
    author: { full_name: string | null; email: string | null } | null;
    resolver: { full_name: string | null; email: string | null } | null;
  }[]).map((row) => ({
    id: row.id,
    photoId: row.photo_id,
    x: Number(row.x),
    y: Number(row.y),
    note: row.note,
    authorName: row.author?.full_name || row.author?.email || null,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedByName: row.resolver?.full_name || row.resolver?.email || null,
  }));
}
