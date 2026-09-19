import { createClient } from "@/lib/supabase/server";
import type { Invoice } from "@/types/domain";

export async function getInvoiceForJob(jobId: string): Promise<Invoice | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("invoices").select("*").eq("job_id", jobId).maybeSingle();
  if (error) throw error;
  return data as unknown as Invoice | null;
}
