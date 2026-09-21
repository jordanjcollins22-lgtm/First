import { createClient } from "@/lib/supabase/server";
import type { Invoice } from "@/types/domain";

export async function getInvoiceForJob(jobId: string): Promise<Invoice | null> {
  const supabase = await createClient();
  // The live one first. A reissued job has a voided bill beside the real
  // one, and the page wants the real one.
  const { data, error } = await supabase.from("invoices").select("*").eq("job_id", jobId).order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as unknown as Invoice[];
  return rows.find((row) => row.status !== "void") ?? rows[0] ?? null;
}
