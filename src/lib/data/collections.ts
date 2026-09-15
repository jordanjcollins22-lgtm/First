import { createClient } from "@/lib/supabase/server";
import { isOwnerLevel } from "@/lib/roles";
import type { OfflineMethod } from "@/lib/collect-payment";
import type { Profile } from "@/types/domain";

/**
 * The cash and checks waiting to be picked up.
 *
 * An account manager sees their own clients' and the ones nobody manages;
 * an owner or admin sees all of them. Each line is enough to go and get
 * it: who, how much, by what, where.
 */
export interface PaymentToCollect {
  invoiceId: string;
  jobId: string;
  clientName: string;
  address: string | null;
  phone: string | null;
  amount: number;
  method: OfflineMethod;
  requestedAt: string | null;
  managerId: string | null;
}

export async function listPaymentsToCollect(profile: Profile): Promise<PaymentToCollect[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("id, job_id, amount, pay_by, pay_by_requested_at, jobs!inner(id, property_id, properties(address, customers(name, phone, account_manager_id)))")
    .eq("organization_id", profile.organization_id)
    .eq("status", "open")
    .not("pay_by", "is", null)
    .order("pay_by_requested_at", { ascending: true });
  if (error) throw error;

  const seesAll = isOwnerLevel(profile.roles) || profile.roles.includes("admin");
  const rows = (data ?? []) as unknown as {
    id: string;
    job_id: string;
    amount: number;
    pay_by: OfflineMethod;
    pay_by_requested_at: string | null;
    jobs: { properties: { address: string | null; customers: { name: string; phone: string | null; account_manager_id: string | null } | null } | null } | null;
  }[];

  return rows
    .map((r) => ({
      invoiceId: r.id,
      jobId: r.job_id,
      clientName: r.jobs?.properties?.customers?.name ?? "Client",
      address: r.jobs?.properties?.address ?? null,
      phone: r.jobs?.properties?.customers?.phone ?? null,
      amount: Number(r.amount),
      method: r.pay_by,
      requestedAt: r.pay_by_requested_at,
      managerId: r.jobs?.properties?.customers?.account_manager_id ?? null,
    }))
    .filter((line) => seesAll || line.managerId === profile.id || line.managerId === null);
}
