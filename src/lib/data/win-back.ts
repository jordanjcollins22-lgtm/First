import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { isAccountManager } from "@/lib/affiliate-roles";
import { winBackRows, type WinBackRow } from "@/lib/win-back";
import type { ProposalZoneSnapshot } from "@/types/domain";

/** How far back a decline is still worth a second try. */
const DECLINED_WITHIN_DAYS = 120;

type Row = {
  job_id: string;
  total_cost: number | string | null;
  discount_amount: number | string | null;
  responded_at: string | null;
  updated_at: string;
  client_response_note: string | null;
  office_declined_by: string | null;
  scope_snapshot: ProposalZoneSnapshot[] | null;
  jobs: {
    status: string;
    properties: { address: string | null; customers: { name: string | null; phone: string | null; email: string | null; account_manager_id: string | null } | null } | null;
  } | null;
};

/**
 * Every proposal a client declined lately, for the owner, admins and account
 * managers: the owner and admins see them all, an account manager their own.
 * Null for anybody else.
 */
export async function getWinBack(now: Date = new Date()): Promise<WinBackRow[] | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const seesAll = isOwnerLevel(profile.roles) || profile.roles.includes("admin");
  if (!seesAll && !isAccountManager(profile.roles)) return null;

  const supabase = await createClient();
  const since = new Date(now.getTime() - DECLINED_WITHIN_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("job_proposals")
    .select(
      "job_id, total_cost, discount_amount, responded_at, updated_at, client_response_note, office_declined_by, scope_snapshot, jobs!inner(status, properties(address, customers(name, phone, email, account_manager_id)))"
    )
    .eq("status", "declined")
    .gte("updated_at", since)
    .limit(200);
  if (error) throw error;

  const rows = ((data ?? []) as unknown as Row[]).filter((r) => seesAll || r.jobs?.properties?.customers?.account_manager_id === profile.id);
  return winBackRows(
    rows.map((r) => {
      const customer = r.jobs?.properties?.customers;
      return {
        jobId: r.job_id,
        client: customer?.name?.trim() || "Client",
        phone: customer?.phone ?? null,
        email: customer?.email ?? null,
        address: r.jobs?.properties?.address ?? null,
        total: Number(r.total_cost ?? 0),
        discount: Number(r.discount_amount ?? 0),
        declinedAt: r.responded_at ?? r.updated_at,
        note: r.client_response_note,
        officeDeclined: Boolean(r.office_declined_by),
        jobStatus: r.jobs?.status ?? "",
        areas: (r.scope_snapshot ?? []).map((z) => ({ zoneName: z.zoneName, serviceLabel: z.serviceLabel })),
      };
    })
  );
}
