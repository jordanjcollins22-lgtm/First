import type { createClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import { canDoEvaluations } from "@/lib/affiliate-roles";
import { POOL_PCT, ROLE_LABEL, SHARE_PCT, sharesFor, type PoolRole } from "@/lib/commission-split";
import type { JobFee } from "@/lib/gross-profit";

type Db = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;

/**
 * What each job's price pays in commission: the 15% pool, and who holds each
 * share of it -- 7% the client's account manager, 4% the evaluator whose site
 * map it is, 4% the affiliate whose link or name brought it in. A share
 * nobody holds, or the owner's, stays with the business, but every price is
 * set with the whole pool in it, so what the business keeps is never what
 * makes a job pay.
 */
export async function feesForJobs(supabase: Db, organizationId: string, jobIds: string[]): Promise<Map<string, JobFee>> {
  const fees = new Map<string, JobFee>();
  if (jobIds.length === 0) return fees;
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, assigned_to, referral_code, referred_by_profile_id, property:properties(customer:customers(account_manager_id))")
    .in("id", jobIds);
  type Row = {
    id: string;
    assigned_to: string | null;
    referral_code: string | null;
    referred_by_profile_id: string | null;
    property: { customer: { account_manager_id: string | null } | null } | null;
  };
  const rows = (jobs ?? []) as unknown as Row[];
  const codes = [...new Set(rows.map((r) => r.referral_code).filter((c): c is string => Boolean(c)))];
  const [{ data: people }, { data: links }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, does_evaluations").eq("organization_id", organizationId),
    codes.length > 0
      ? supabase.from("outreach_links").select("code, profile_id").eq("organization_id", organizationId).in("code", codes)
      : Promise.resolve({ data: [] as { code: string; profile_id: string }[] }),
  ]);
  const ids = (people ?? []).map((p) => p.id);
  const { data: roleRows } = ids.length > 0 ? await supabase.from("profile_roles").select("profile_id, role_name").in("profile_id", ids) : { data: [] };
  const rolesOf = new Map<string, string[]>();
  for (const r of (roleRows ?? []) as { profile_id: string; role_name: string }[]) {
    rolesOf.set(r.profile_id, [...(rolesOf.get(r.profile_id) ?? []), r.role_name]);
  }
  const personById = new Map((people ?? []).map((p) => [p.id, p]));
  const owners = new Set(ids.filter((id) => (rolesOf.get(id) ?? []).some((r) => ["admin", "owner"].includes(r.toLowerCase().trim()))));
  const posterByCode = new Map((links ?? []).map((l) => [l.code, l.profile_id]));
  const firstName = (id: string) => {
    const p = personById.get(id);
    return (p?.full_name || p?.email || "").trim().split(/[\s@]/)[0] || "Somebody";
  };

  for (const id of jobIds) {
    const row = rows.find((r) => r.id === id);
    const affiliate = row ? (row.referred_by_profile_id ?? (row.referral_code ? posterByCode.get(row.referral_code) : undefined)) : undefined;
    const evaluator = row?.assigned_to;
    const holders = {
      accountManagerId: row?.property?.customer?.account_manager_id ?? null,
      evaluatorId: evaluator && canDoEvaluations(rolesOf.get(evaluator) ?? [], personById.get(evaluator)?.does_evaluations) ? evaluator : null,
      affiliateId: affiliate && personById.has(affiliate) ? affiliate : null,
    };
    const held = new Map<PoolRole, string>();
    for (const share of sharesFor(holders, owners)) for (const role of share.roles) held.set(role, share.profileId);
    const shares = (["account_manager", "evaluator", "affiliate"] as PoolRole[]).map((role) => {
      const who = held.get(role);
      const what = `${SHARE_PCT[role]}% ${ROLE_LABEL[role].toLowerCase()}`;
      return who ? `${firstName(who)} ${what}` : `${what}, kept`;
    });
    fees.set(id, { kind: "pool", name: "Commission pool", pct: POOL_PCT, shares });
  }
  return fees;
}
