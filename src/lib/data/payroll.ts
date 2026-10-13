import { getCommissionByManager } from "@/lib/data/commission";
import { financeDb, getFinanceSettings } from "@/lib/data/finance-settings";
import { listProfiles } from "@/lib/data/team";
import { addDays } from "@/lib/finance/dates";
import { adpCsv, gustoCsv, payrollWeek, splitName, type PayrollLine } from "@/lib/finance/payroll";
import { getIntegration } from "@/lib/integrations/store";

/**
 * One payroll week, read from the time clock, the crew day and the
 * commission books, and the file the payroll provider imports.
 */

export interface PayrollSetup {
  format: "gusto" | "adp";
  sendTo: string | null;
  adpCompanyCode: string | null;
  adpCommissionCode: string | null;
  connected: boolean;
}

export async function payrollSetup(organizationId: string): Promise<PayrollSetup> {
  const row = await getIntegration(organizationId, "payroll");
  const s = row?.settings ?? {};
  const str = (k: string) => (typeof s[k] === "string" && (s[k] as string).trim()) || null;
  return {
    format: str("format")?.toLowerCase() === "adp" ? "adp" : "gusto",
    sendTo: str("send_to"),
    adpCompanyCode: str("adp_company_code"),
    adpCommissionCode: str("adp_commission_code"),
    connected: Boolean(row && row.status !== "not_connected"),
  };
}

export interface PayrollWeekView {
  weekStart: string;
  weekEnd: string;
  lines: PayrollLine[];
  totals: { hours: number; overtime: number; commission: number };
  setup: PayrollSetup;
  sent: { sentTo: string; sentAt: string | null; status: string }[];
}

export async function loadPayrollWeek(organizationId: string, weekStart: string): Promise<PayrollWeekView> {
  const weekEnd = addDays(weekStart, 6);
  const db = financeDb();
  // A day either side in UTC, so a shift that starts late in Maryland isn't missed; payrollWeek keeps only the week's own days.
  const from = `${addDays(weekStart, -1)}T00:00:00Z`;
  const to = `${addDays(weekEnd, 2)}T00:00:00Z`;
  const [profiles, settings, setup, { data: entries }, { data: events }, { data: sent }] = await Promise.all([
    listProfiles(),
    getFinanceSettings(organizationId),
    payrollSetup(organizationId),
    db.from("time_entries").select("profile_id, clocked_in_at, clocked_out_at").eq("organization_id", organizationId).gte("clocked_in_at", from).lt("clocked_in_at", to),
    db.from("crew_day_events").select("profile_id, day, kind, at").eq("organization_id", organizationId).gte("day", weekStart).lte("day", weekEnd),
    db.from("payroll_exports").select("sent_to, sent_at, status").eq("organization_id", organizationId).eq("week_start", weekStart),
  ]);
  const mine = profiles.filter((p) => p.organization_id === organizationId);

  // Commission payable now (finished, clean, collected, less anything paid).
  let commissions = new Map<string, number>();
  try {
    const books = await getCommissionByManager(mine);
    commissions = new Map(books.map((b) => [b.profileId, Math.max(0, b.summary.earned - (b.advanceOwed ?? 0))]));
  } catch {
    commissions = new Map();
  }

  const lines = payrollWeek({
    weekStart,
    people: mine.map((p) => ({ id: p.id, ...splitName(p.full_name, p.first_name, p.last_name), payrollId: settings.payrollIds[p.id] ?? null })),
    entries: ((entries ?? []) as { profile_id: string; clocked_in_at: string; clocked_out_at: string | null }[]).map((e) => ({
      profileId: e.profile_id,
      clockedInAt: e.clocked_in_at,
      clockedOutAt: e.clocked_out_at,
    })),
    events: ((events ?? []) as { profile_id: string; day: string; kind: string; at: string }[]).map((e) => ({ profileId: e.profile_id, day: e.day, kind: e.kind, at: e.at })),
    commissions,
  });
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    weekStart,
    weekEnd,
    lines,
    totals: {
      hours: r2(lines.reduce((s, l) => s + l.totalHours, 0)),
      overtime: r2(lines.reduce((s, l) => s + l.overtimeHours, 0)),
      commission: r2(lines.reduce((s, l) => s + l.commission, 0)),
    },
    setup,
    sent: ((sent ?? []) as { sent_to: string; sent_at: string | null; status: string }[]).map((s) => ({ sentTo: s.sent_to, sentAt: s.sent_at, status: s.status })),
  };
}

/** The import file for the week, in the provider's format. */
export function payrollFile(view: PayrollWeekView, format: "gusto" | "adp" = view.setup.format): { filename: string; csv: string } {
  const csv =
    format === "adp"
      ? adpCsv(view.lines, {
          companyCode: view.setup.adpCompanyCode ?? undefined,
          batchId: `JS${view.weekStart.replace(/-/g, "").slice(2)}`,
          commissionCode: view.setup.adpCommissionCode ?? undefined,
        })
      : gustoCsv(view.lines);
  return { filename: `payroll-${format}-${view.weekStart}.csv`, csv };
}
