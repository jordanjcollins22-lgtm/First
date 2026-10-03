import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What the business owes one person and has not paid yet.
 *
 * Read with the admin client and filtered to the one profile, so a crew
 * member sees their own line and nobody else's whatever the table's
 * policies say.
 */
export interface OwedLine {
  id: string;
  amount: number;
  on: string | null;
  note: string | null;
}

export async function owedToProfile(profileId: string): Promise<{ total: number; lines: OwedLine[] }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("team_payments")
    .select("id, amount, period_end, period_start, created_at, note")
    .eq("profile_id", profileId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);
  const lines = (data ?? []).map((row) => ({
    id: row.id,
    amount: Number(row.amount),
    on: row.period_end ?? row.period_start ?? row.created_at.slice(0, 10),
    note: row.note,
  }));
  return { total: lines.reduce((sum, line) => sum + line.amount, 0), lines };
}
