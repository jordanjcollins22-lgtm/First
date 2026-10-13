/**
 * The switches for every operations automation, with their defaults.
 *
 * One row per business in ops_autopilot_settings. Each automation has an
 * on/off and a `started_at`: the moment it was first switched on. Nothing an
 * automation does reaches back before its own started_at, so turning one on
 * never sweeps up the backlog. A missing row reads as these defaults, and the
 * first cron run writes the row and stamps the start times.
 */

export interface AutopilotSettings {
  autoCloseEnabled: boolean;
  autoCloseStartedAt: string | null;
  /** Minutes after midnight, business time, an open session becomes an exception. */
  unclosedCutoffMinutes: number;

  completionChainEnabled: boolean;
  completionChainStartedAt: string | null;
  invoiceAfterClientApproval: boolean;
  signoffOverdueHours: number;
  overBudgetPct: number;
  laborBurdenPct: number;

  checkinLeadFirstEnabled: boolean;
  checkinStartedAt: string | null;
  checkinEscalateMinutes: number;

  autoPlaceEnabled: boolean;
  autoPlaceStartedAt: string | null;
  autoPlaceMinNoticeDays: number;
  autoPlaceDailyCap: number;

  crewBonusEnabled: boolean;
  crewBonusStartedAt: string | null;
  crewBonusPerMemberCents: number;
}

export const AUTOPILOT_DEFAULTS: AutopilotSettings = {
  autoCloseEnabled: true,
  autoCloseStartedAt: null,
  unclosedCutoffMinutes: 21 * 60,
  completionChainEnabled: true,
  completionChainStartedAt: null,
  invoiceAfterClientApproval: true,
  signoffOverdueHours: 72,
  overBudgetPct: 10,
  laborBurdenPct: 0,
  checkinLeadFirstEnabled: true,
  checkinStartedAt: null,
  checkinEscalateMinutes: 30,
  autoPlaceEnabled: true,
  autoPlaceStartedAt: null,
  autoPlaceMinNoticeDays: 2,
  autoPlaceDailyCap: 5,
  crewBonusEnabled: false,
  crewBonusStartedAt: null,
  crewBonusPerMemberCents: 5000,
};

export type SettingsRow = Record<string, unknown>;

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const int = (v: unknown, d: number, min: number, max: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d;
};
const num = (v: unknown, d: number, min: number, max: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const at = (v: unknown) => (typeof v === "string" && v ? v : null);

/** A database row (or nothing) as settings, every value clamped to something sane. */
export function settingsFromRow(row: SettingsRow | null | undefined): AutopilotSettings {
  const r = row ?? {};
  const d = AUTOPILOT_DEFAULTS;
  return {
    autoCloseEnabled: bool(r.auto_close_enabled, d.autoCloseEnabled),
    autoCloseStartedAt: at(r.auto_close_started_at),
    unclosedCutoffMinutes: int(r.unclosed_cutoff_minutes, d.unclosedCutoffMinutes, 12 * 60, 24 * 60 - 1),
    completionChainEnabled: bool(r.completion_chain_enabled, d.completionChainEnabled),
    completionChainStartedAt: at(r.completion_chain_started_at),
    invoiceAfterClientApproval: bool(r.invoice_after_client_approval, d.invoiceAfterClientApproval),
    signoffOverdueHours: int(r.signoff_overdue_hours, d.signoffOverdueHours, 1, 24 * 30),
    overBudgetPct: int(r.over_budget_pct, d.overBudgetPct, 0, 100),
    laborBurdenPct: num(r.labor_burden_pct, d.laborBurdenPct, 0, 100),
    checkinLeadFirstEnabled: bool(r.checkin_lead_first_enabled, d.checkinLeadFirstEnabled),
    checkinStartedAt: at(r.checkin_started_at),
    checkinEscalateMinutes: int(r.checkin_escalate_minutes, d.checkinEscalateMinutes, 5, 240),
    autoPlaceEnabled: bool(r.auto_place_enabled, d.autoPlaceEnabled),
    autoPlaceStartedAt: at(r.auto_place_started_at),
    autoPlaceMinNoticeDays: int(r.auto_place_min_notice_days, d.autoPlaceMinNoticeDays, 1, 14),
    autoPlaceDailyCap: int(r.auto_place_daily_cap, d.autoPlaceDailyCap, 0, 50),
    crewBonusEnabled: bool(r.crew_bonus_enabled, d.crewBonusEnabled),
    crewBonusStartedAt: at(r.crew_bonus_started_at),
    crewBonusPerMemberCents: int(r.crew_bonus_per_member_cents, d.crewBonusPerMemberCents, 0, 100_000),
  };
}

/** The switches and their started_at columns, so stamping is one loop. */
export const SWITCHES = [
  { enabled: "auto_close_enabled", started: "auto_close_started_at" },
  { enabled: "completion_chain_enabled", started: "completion_chain_started_at" },
  { enabled: "checkin_lead_first_enabled", started: "checkin_started_at" },
  { enabled: "auto_place_enabled", started: "auto_place_started_at" },
  { enabled: "crew_bonus_enabled", started: "crew_bonus_started_at" },
] as const;

/**
 * The started_at values to write: any switch that is on and has never been
 * started gets `now`. A switch turned back on after being off (`restarted`)
 * also starts again from now, so whatever piled up while it was off is not
 * swept up the moment it comes back.
 */
export function startStamps(row: SettingsRow, now: string, restarted: readonly string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of SWITCHES) {
    const on = row[s.enabled] ?? (AUTOPILOT_DEFAULTS as unknown as Record<string, unknown>)[camel(s.enabled)];
    if (on === true && (!row[s.started] || restarted.includes(s.enabled))) out[s.started] = now;
  }
  return out;
}

function camel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
