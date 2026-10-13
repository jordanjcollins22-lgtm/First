/**
 * The weather and snow switches, read off their row with defaults behind
 * anything unset. Pure, so the panels and the cron read them the same way.
 */

import { DEFAULT_RAIN_RULES, rainRulesFrom, type RainRules } from "@/lib/weather-cascade/rules";

export interface WeatherOpsSettings {
  /** False until the weather_ops_settings table exists. */
  ready: boolean;
  cascadeEnabled: boolean;
  cascadeStartedAt: string | null;
  coverExisting: boolean;
  autoApply: boolean;
  maxAutoShiftDays: number;
  maxAutoMoves: number;
  workWeekdays: number[];
  rules: RainRules;
  notifyClients: boolean;
  notifyCrew: boolean;
  snowSuggestEnabled: boolean;
  snowSuggestStartedAt: string | null;
  snowTriggerIn: number;
  snowClientNotice: boolean;
  snowClientNoticeStartedAt: string | null;
  snowInvoicingEnabled: boolean;
  snowInvoicingStartedAt: string | null;
  lastRunAt: string | null;
  lastRunSummary: Record<string, unknown> | null;
}

export const DEFAULT_WEATHER_OPS: WeatherOpsSettings = {
  ready: false,
  cascadeEnabled: false,
  cascadeStartedAt: null,
  coverExisting: false,
  autoApply: true,
  maxAutoShiftDays: 3,
  maxAutoMoves: 25,
  workWeekdays: [1, 2, 3, 4, 5],
  rules: DEFAULT_RAIN_RULES,
  notifyClients: true,
  notifyCrew: true,
  snowSuggestEnabled: false,
  snowSuggestStartedAt: null,
  snowTriggerIn: 1,
  snowClientNotice: false,
  snowClientNoticeStartedAt: null,
  snowInvoicingEnabled: false,
  snowInvoicingStartedAt: null,
  lastRunAt: null,
  lastRunSummary: null,
};

export function weatherOpsFrom(row: Record<string, unknown> | null | undefined, ready = true): WeatherOpsSettings {
  if (!row) return { ...DEFAULT_WEATHER_OPS, ready };
  const bool = (key: string, fallback: boolean) => (typeof row[key] === "boolean" ? (row[key] as boolean) : fallback);
  const int = (key: string, fallback: number) => {
    const v = Number(row[key]);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : fallback;
  };
  const str = (key: string) => (typeof row[key] === "string" ? (row[key] as string) : null);
  const weekdays = Array.isArray(row.work_weekdays)
    ? (row.work_weekdays as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    : DEFAULT_WEATHER_OPS.workWeekdays;
  const trigger = Number(row.snow_trigger_in);
  return {
    ready,
    cascadeEnabled: bool("cascade_enabled", false),
    cascadeStartedAt: str("cascade_started_at"),
    coverExisting: bool("cover_existing", false),
    autoApply: bool("auto_apply", true),
    maxAutoShiftDays: int("max_auto_shift_days", 3),
    maxAutoMoves: int("max_auto_moves", 25),
    workWeekdays: weekdays.length > 0 ? weekdays : DEFAULT_WEATHER_OPS.workWeekdays,
    rules: rainRulesFrom(row),
    notifyClients: bool("notify_clients", true),
    notifyCrew: bool("notify_crew", true),
    snowSuggestEnabled: bool("snow_suggest_enabled", false),
    snowSuggestStartedAt: str("snow_suggest_started_at"),
    snowTriggerIn: Number.isFinite(trigger) && trigger > 0 ? trigger : 1,
    snowClientNotice: bool("snow_client_notice", false),
    snowClientNoticeStartedAt: str("snow_client_notice_started_at"),
    snowInvoicingEnabled: bool("snow_invoicing_enabled", false),
    snowInvoicingStartedAt: str("snow_invoicing_started_at"),
    lastRunAt: str("last_run_at"),
    lastRunSummary: (row.last_run_summary as Record<string, unknown> | null) ?? null,
  };
}

/**
 * Whether a visit is the cascade's to move.
 *
 * Only work created or changed after the switch went on, unless the owner
 * chose to cover what was already on the calendar. Never a visit that has
 * started, finished or been called off.
 */
export function cascadeMayMove(
  session: { status: string; created_at: string; updated_at: string },
  settings: Pick<WeatherOpsSettings, "cascadeStartedAt" | "coverExisting">
): boolean {
  if (session.status !== "scheduled") return false;
  if (settings.coverExisting) return true;
  if (!settings.cascadeStartedAt) return false;
  const since = Date.parse(settings.cascadeStartedAt);
  return Date.parse(session.created_at) >= since || Date.parse(session.updated_at) >= since;
}

/** Whether an automation switched on at `startedAt` covers a record from `at`. */
export function coveredSince(startedAt: string | null, at: string | null): boolean {
  if (!startedAt || !at) return false;
  return Date.parse(at) >= Date.parse(startedAt);
}
