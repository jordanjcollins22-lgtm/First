import type { createClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_ACCOUNT_MANAGER_PCT } from "@/lib/commission";
import type { JobFee } from "@/lib/gross-profit";

type Db = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;

/**
 * Who is paid a share of each job's price: the affiliate whose link or name
 * brought it in, or else the client's account manager, each at the
 * percentage on their profile. A job with neither is priced as if an account
 * manager at the usual rate will look after it, which is what happens.
 */
export async function feesForJobs(supabase: Db, organizationId: string, jobIds: string[]): Promise<Map<string, JobFee>> {
  const fees = new Map<string, JobFee>();
  if (jobIds.length === 0) return fees;
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, referral_code, referred_by_profile_id, property:properties(customer:customers(account_manager_id))")
    .in("id", jobIds);
  type Row = { id: string; referral_code: string | null; referred_by_profile_id: string | null; property: { customer: { account_manager_id: string | null } | null } | null };
  const rows = (jobs ?? []) as unknown as Row[];
  const codes = [...new Set(rows.map((r) => r.referral_code).filter((c): c is string => Boolean(c)))];
  const [{ data: people }, { data: links }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, commission_pct").eq("organization_id", organizationId),
    codes.length > 0
      ? supabase.from("outreach_links").select("code, profile_id").eq("organization_id", organizationId).in("code", codes)
      : Promise.resolve({ data: [] as { code: string; profile_id: string }[] }),
  ]);
  const personById = new Map((people ?? []).map((p) => [p.id, p]));
  const posterByCode = new Map((links ?? []).map((l) => [l.code, l.profile_id]));
  const firstName = (id: string) => {
    const p = personById.get(id);
    return (p?.full_name || p?.email || "").trim().split(/[\s@]/)[0] || null;
  };
  const pctOf = (id: string) => {
    const pct = personById.get(id)?.commission_pct;
    return pct == null ? DEFAULT_ACCOUNT_MANAGER_PCT : Number(pct);
  };
  for (const row of rows) {
    const affiliate = row.referred_by_profile_id ?? (row.referral_code ? posterByCode.get(row.referral_code) : undefined);
    const manager = row.property?.customer?.account_manager_id ?? null;
    if (affiliate && personById.has(affiliate)) fees.set(row.id, { kind: "affiliate", name: firstName(affiliate) ?? "Affiliate", pct: pctOf(affiliate) });
    else if (manager && personById.has(manager)) fees.set(row.id, { kind: "account-manager", name: firstName(manager) ?? "Account manager", pct: pctOf(manager) });
  }
  for (const id of jobIds) if (!fees.has(id)) fees.set(id, { kind: "account-manager", name: "Account manager", pct: DEFAULT_ACCOUNT_MANAGER_PCT });
  return fees;
}
