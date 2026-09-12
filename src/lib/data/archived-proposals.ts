import { createClient } from "@/lib/supabase/server";
import type { ArchivedProposal } from "@/lib/proposal-archive";

/**
 * The old quotes on one client.
 *
 * Tolerated rather than required: before migration 0138 the table is not
 * there, and a client record that refuses to load because nobody has archived
 * anything yet is worse than one showing an empty panel.
 */
export async function listArchivedProposals(customerId: string): Promise<ArchivedProposal[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("archived_proposals")
      .select("id, file_path, file_name, outcome, job_date, title, amount, notes")
      .eq("customer_id", customerId)
      .order("job_date", { ascending: false });

    return ((data ?? []) as unknown as {
      id: string;
      file_path: string;
      file_name: string;
      outcome: string;
      job_date: string | null;
      title: string | null;
      amount: number | null;
      notes: string | null;
    }[]).map((row) => ({
      id: row.id,
      filePath: row.file_path,
      fileName: row.file_name,
      outcome: row.outcome,
      jobDate: row.job_date,
      title: row.title,
      amount: row.amount != null ? Number(row.amount) : null,
      notes: row.notes,
    }));
  } catch {
    return [];
  }
}
