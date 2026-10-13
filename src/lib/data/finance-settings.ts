import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The business's invoicing, collections, payroll and QuickBooks settings
 * (finance_settings, migration 0363). A missing row, or the table not
 * existing yet, reads as the defaults: everything automatic is off.
 */

export interface FinanceSettings {
  autopayEnabled: boolean;
  autopayStartedAt: string | null;
  offerAch: boolean;
  lateFeeEnabled: boolean;
  lateFeeStartedAt: string | null;
  lateFeeKind: "percent" | "flat";
  lateFeeAmount: number;
  lateFeeGraceDays: number;
  dsoTargetDays: number;
  payrollIds: Record<string, string>;
  qboSyncEnabled: boolean;
  qboSyncStartedAt: string | null;
  qboSyncFrom: string | null;
  targets: Record<string, number>;
  /** False until migration 0363 is applied; saving needs it. */
  ready: boolean;
}

export const FINANCE_DEFAULTS: FinanceSettings = {
  autopayEnabled: false,
  autopayStartedAt: null,
  offerAch: true,
  lateFeeEnabled: false,
  lateFeeStartedAt: null,
  lateFeeKind: "percent",
  lateFeeAmount: 1.5,
  lateFeeGraceDays: 15,
  dsoTargetDays: 30,
  payrollIds: {},
  qboSyncEnabled: false,
  qboSyncStartedAt: null,
  qboSyncFrom: null,
  targets: {},
  ready: false,
};

export const financeDb = () => createAdminClient() as unknown as SupabaseClient;

interface Row {
  autopay_enabled: boolean;
  autopay_started_at: string | null;
  offer_ach: boolean;
  late_fee_enabled: boolean;
  late_fee_started_at: string | null;
  late_fee_kind: "percent" | "flat";
  late_fee_amount: number | string;
  late_fee_grace_days: number;
  dso_target_days: number;
  payroll_ids: Record<string, string> | null;
  qbo_sync_enabled: boolean;
  qbo_sync_started_at: string | null;
  qbo_sync_from: string | null;
  targets: Record<string, number> | null;
}

export async function getFinanceSettings(organizationId: string): Promise<FinanceSettings> {
  const { data, error } = await financeDb().from("finance_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  if (error) return FINANCE_DEFAULTS;
  const r = data as Row | null;
  if (!r) return { ...FINANCE_DEFAULTS, ready: true };
  return {
    autopayEnabled: r.autopay_enabled,
    autopayStartedAt: r.autopay_started_at,
    offerAch: r.offer_ach,
    lateFeeEnabled: r.late_fee_enabled,
    lateFeeStartedAt: r.late_fee_started_at,
    lateFeeKind: r.late_fee_kind,
    lateFeeAmount: Number(r.late_fee_amount),
    lateFeeGraceDays: r.late_fee_grace_days,
    dsoTargetDays: r.dso_target_days,
    payrollIds: r.payroll_ids ?? {},
    qboSyncEnabled: r.qbo_sync_enabled,
    qboSyncStartedAt: r.qbo_sync_started_at,
    qboSyncFrom: r.qbo_sync_from,
    targets: r.targets ?? {},
    ready: true,
  };
}

/**
 * Saves a change. Switching an automation on for the first time stamps when
 * it started, and that stamp is never moved again, so it only ever acts on
 * what came after the owner turned it on.
 */
export async function saveFinanceSettings(
  organizationId: string,
  patch: Partial<Record<keyof Row, unknown>>,
  updatedBy: string | null
): Promise<void> {
  const current = await getFinanceSettings(organizationId);
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { ...patch, organization_id: organizationId, updated_at: now, updated_by: updatedBy };
  if (patch.autopay_enabled === true && !current.autopayStartedAt) row.autopay_started_at = now;
  if (patch.late_fee_enabled === true && !current.lateFeeStartedAt) row.late_fee_started_at = now;
  if (patch.qbo_sync_enabled === true && !current.qboSyncStartedAt) {
    row.qbo_sync_started_at = now;
    if (!current.qboSyncFrom && patch.qbo_sync_from === undefined) row.qbo_sync_from = now;
  }
  const { error } = await financeDb().from("finance_settings").upsert(row);
  if (error) throw error;
}
