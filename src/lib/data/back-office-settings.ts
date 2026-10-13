import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_REMINDER_DAYS } from "@/lib/compliance/calendar";

/**
 * The back office's switches: commission accrual, hold-back, compliance
 * reminders, onboarding checklists and the fertilizer guard. One row per
 * business; a missing row, or the table not existing yet, reads as the
 * defaults, which are everything off except the guard.
 */

export interface BackOfficeSettings {
  commissionAccrualOn: boolean;
  commissionAccrualStartedAt: string | null;
  defaultAccountManagerPct: number;
  defaultEvaluatorPct: number;
  defaultAffiliatePct: number;
  holdbackOn: boolean;
  holdbackCollectPct: number;
  holdbackMarginPct: number;
  holdbackCrewCostPerHour: number;
  complianceRemindersOn: boolean;
  complianceRemindersStartedAt: string | null;
  reminderDays: number[];
  onboardingOn: boolean;
  onboardingStartedAt: string | null;
  fertilizerGuardOn: boolean;
  /** False until the table exists: saving needs it. */
  ready: boolean;
}

export const SETTINGS_DEFAULTS: BackOfficeSettings = {
  commissionAccrualOn: false,
  commissionAccrualStartedAt: null,
  defaultAccountManagerPct: 7,
  defaultEvaluatorPct: 4,
  defaultAffiliatePct: 4,
  holdbackOn: false,
  holdbackCollectPct: 50,
  holdbackMarginPct: 40,
  holdbackCrewCostPerHour: 35,
  complianceRemindersOn: false,
  complianceRemindersStartedAt: null,
  reminderDays: DEFAULT_REMINDER_DAYS,
  onboardingOn: false,
  onboardingStartedAt: null,
  fertilizerGuardOn: true,
  ready: false,
};

/** The column for each setting a person can change. */
export const SETTING_COLUMN = {
  commissionAccrualOn: "commission_accrual_on",
  defaultAccountManagerPct: "default_account_manager_pct",
  defaultEvaluatorPct: "default_evaluator_pct",
  defaultAffiliatePct: "default_affiliate_pct",
  holdbackOn: "commission_holdback_on",
  holdbackCollectPct: "holdback_collect_pct",
  holdbackMarginPct: "holdback_margin_pct",
  holdbackCrewCostPerHour: "holdback_crew_cost_per_hour",
  complianceRemindersOn: "compliance_reminders_on",
  onboardingOn: "onboarding_on",
  fertilizerGuardOn: "fertilizer_guard_on",
} as const;

export type EditableSetting = keyof typeof SETTING_COLUMN;

/** The started_at column each switch stamps the first time it goes on. */
export const STARTED_COLUMN: Partial<Record<EditableSetting, string>> = {
  commissionAccrualOn: "commission_accrual_started_at",
  complianceRemindersOn: "compliance_reminders_started_at",
  onboardingOn: "onboarding_started_at",
};

const num = (v: unknown, fallback: number) => (v == null || Number.isNaN(Number(v)) ? fallback : Number(v));

export function settingsFromRow(row: Record<string, unknown> | null, ready: boolean): BackOfficeSettings {
  if (!row) return { ...SETTINGS_DEFAULTS, ready };
  const d = SETTINGS_DEFAULTS;
  return {
    commissionAccrualOn: Boolean(row.commission_accrual_on),
    commissionAccrualStartedAt: (row.commission_accrual_started_at as string | null) ?? null,
    defaultAccountManagerPct: num(row.default_account_manager_pct, d.defaultAccountManagerPct),
    defaultEvaluatorPct: num(row.default_evaluator_pct, d.defaultEvaluatorPct),
    defaultAffiliatePct: num(row.default_affiliate_pct, d.defaultAffiliatePct),
    holdbackOn: Boolean(row.commission_holdback_on),
    holdbackCollectPct: num(row.holdback_collect_pct, d.holdbackCollectPct),
    holdbackMarginPct: num(row.holdback_margin_pct, d.holdbackMarginPct),
    holdbackCrewCostPerHour: num(row.holdback_crew_cost_per_hour, d.holdbackCrewCostPerHour),
    complianceRemindersOn: Boolean(row.compliance_reminders_on),
    complianceRemindersStartedAt: (row.compliance_reminders_started_at as string | null) ?? null,
    reminderDays: Array.isArray(row.reminder_days) && row.reminder_days.length ? (row.reminder_days as number[]).map(Number) : d.reminderDays,
    onboardingOn: Boolean(row.onboarding_on),
    onboardingStartedAt: (row.onboarding_started_at as string | null) ?? null,
    fertilizerGuardOn: row.fertilizer_guard_on == null ? true : Boolean(row.fertilizer_guard_on),
    ready,
  };
}

/** Read with any client: the row is org-scoped under RLS, and the service role reads it for crons and webhooks. */
export async function loadBackOfficeSettings(client: unknown, organizationId: string): Promise<BackOfficeSettings> {
  const sb = client as SupabaseClient;
  const { data, error } = await sb.from("back_office_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  return settingsFromRow((data as Record<string, unknown> | null) ?? null, !error);
}

/** For server code with nobody signed in. */
export async function loadBackOfficeSettingsAdmin(organizationId: string): Promise<BackOfficeSettings> {
  return loadBackOfficeSettings(createAdminClient(), organizationId);
}

/** Every business with a switch on, for a cron. */
export async function organizationsWith(column: "commission_accrual_on" | "compliance_reminders_on" | "onboarding_on"): Promise<{ organizationId: string; settings: BackOfficeSettings }[]> {
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin.from("back_office_settings").select("*").eq(column, true);
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    organizationId: row.organization_id as string,
    settings: settingsFromRow(row, true),
  }));
}

/** Whether a record falls after a switch's start: the rule that keeps a switch from sweeping up the backlog. */
export function afterStart(at: string | null | undefined, startedAt: string | null): boolean {
  if (!startedAt || !at) return false;
  // Parsed, not compared as text: Postgres writes "+00:00" where JS writes "Z".
  return Date.parse(at) >= Date.parse(startedAt);
}
