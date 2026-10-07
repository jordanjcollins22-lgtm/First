import { createClient } from "@/lib/supabase/server";

export interface JobReceipt {
  id: string;
  what: string;
  amountCents: number | null;
  /** Signed: the bucket is private. */
  url: string | null;
  byName: string | null;
  at: string;
}

/** The receipts for what the crew bought on this job, newest first. */
export async function listJobReceipts(jobId: string): Promise<JobReceipt[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_receipts")
    .select("id, path, what, amount_cents, created_at, profiles:uploaded_by(full_name, email)")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as unknown as {
    id: string;
    path: string;
    what: string;
    amount_cents: number | null;
    created_at: string;
    profiles: { full_name: string | null; email: string } | null;
  }[];
  if (rows.length === 0) return [];
  const { data: signed } = await supabase.storage.from("job-photos").createSignedUrls(rows.map((r) => r.path), 60 * 60);
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return rows.map((r) => ({
    id: r.id,
    what: r.what,
    amountCents: r.amount_cents,
    url: urlByPath.get(r.path) ?? null,
    byName: (r.profiles?.full_name || r.profiles?.email || "").split(/\s+/)[0] || null,
    at: r.created_at,
  }));
}
