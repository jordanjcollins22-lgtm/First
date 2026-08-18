import { createClient } from "@/lib/supabase/server";
import type { JobPhoto, JobPhotoKind } from "@/types/domain";

export interface JobPhotoWithUrl extends JobPhoto {
  /** Camel-cased alias of zone_id, so the row satisfies the rules module's
   * PhotoRecord shape without a mapping step at every call site. */
  zoneId: string | null;
  /** Signed, because the bucket is private — these are photographs of
   * customers' homes and a public URL would be readable by anyone holding it. */
  url: string | null;
  uploaderName: string | null;
}

/** An hour is long enough to work through a job page and short enough that a
 * copied URL stops working before it can be passed around. */
const URL_TTL_SECONDS = 60 * 60;

export async function listJobPhotos(jobId: string): Promise<JobPhotoWithUrl[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("job_photos")
    .select("*, profiles:uploaded_by(full_name, email)")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];

  const rows = data as unknown as (JobPhoto & {
    profiles: { full_name: string | null; email: string } | null;
  })[];
  if (rows.length === 0) return [];

  // One round trip for every URL rather than one per photo — a job with
  // twenty shots would otherwise make twenty calls to render one page.
  const { data: signed } = await supabase.storage
    .from("job-photos")
    .createSignedUrls(rows.map((r) => r.path), URL_TTL_SECONDS);

  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return rows.map((row) => ({
    ...row,
    kind: row.kind as JobPhotoKind,
    zoneId: row.zone_id,
    url: urlByPath.get(row.path) ?? null,
    uploaderName: row.profiles?.full_name || row.profiles?.email || null,
  }));
}
