import { financeDb, getFinanceSettings, type FinanceSettings } from "@/lib/data/finance-settings";
import { isPlaidConfigured, isPlaidLive } from "@/lib/env";
import { arAging, dso, lateFeeFor, type Aging, type ArInvoice } from "@/lib/finance/ar";
import { listAutopayClients, type AutopayClient } from "@/lib/finance/autopay";
import { addDays, inRange, localDay, mondayOf, periodStart, type Period } from "@/lib/finance/dates";
import {
  BANDS,
  divisionOf,
  dsoBand,
  isMarketingCharge,
  isOperatingExpense,
  marginsByDivision,
  pct,
  toneFor,
  trendTone,
  type CostedJob,
  type DivisionMargin,
  type ScorecardMetric,
  type Tone,
} from "@/lib/finance/metrics";
import { qboSyncStatus, type QboSyncStatus } from "@/lib/integrations/quickbooks/sync";
import { getIntegration } from "@/lib/integrations/store";

/**
 * Everything the owner's Finance page shows, read in one pass. Every source
 * is optional: no Plaid means no cash or spend figures, no job costing means
 * no margins, and each says so instead of showing a zero that isn't one.
 */

export interface NeedsYou {
  key: string;
  text: string;
  tone: "bad" | "warn";
}

export interface Kpi {
  label: string;
  value: number | null;
  /** How to print it. */
  unit: "$" | "%" | "days";
  tone: Tone;
  target: string;
  note?: string;
}

export interface FinanceDashboard {
  today: string;
  settings: FinanceSettings;
  needsYou: NeedsYou[];
  revenue: Record<Period, { invoiced: number; collected: number }>;
  aging: Aging & { lateFees: number };
  dso: number | null;
  margins: DivisionMargin[];
  costedJobs: number;
  cash: { connected: boolean; live: boolean; balance: number | null; asOf: string | null; accounts: number };
  ratios: { marketing: Kpi; labor: Kpi; net: Kpi };
  scorecard: ScorecardMetric[];
  autopay: AutopayClient[];
  qbo: QboSyncStatus & { connected: boolean; enabled: boolean };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: number[]) => r2(xs.reduce((s, x) => s + x, 0));

export async function loadFinanceDashboard(organizationId: string, now = new Date()): Promise<FinanceDashboard> {
  const db = financeDb();
  const today = localDay(now);
  const ytd = periodStart(today, "ytd");
  // Far enough back for YTD, a 90-day DSO window and a 13-week trend.
  const from = [ytd, addDays(today, -120)].sort()[0];
  const fromTs = `${addDays(from, -1)}T00:00:00Z`;

  const [
    settings,
    { data: invRows },
    { data: clientInvRows },
    { data: payRows },
    { data: jobRows },
    { data: org },
    { data: accounts },
    { data: txns },
    { data: teamPays },
    { data: ledger },
    { data: proposals },
    { data: failedCharges },
    autopay,
    qbo,
    qboRow,
  ] = await Promise.all([
    getFinanceSettings(organizationId),
    db
      .from("invoices")
      .select("id, job_id, amount, status, sent_at, created_at, hosted_invoice_url, jobs(name, properties(customers(name)))")
      .eq("organization_id", organizationId)
      .neq("status", "void")
      .or(`status.eq.open,created_at.gte.${fromTs}`),
    db
      .from("client_invoices")
      .select("id, amount, issued_on, due_on, paid_on, title, invoice_number, customers(name)")
      .eq("organization_id", organizationId)
      .or(`paid_on.is.null,issued_on.gte.${from}`),
    db
      .from("payments")
      .select("amount_cents, surcharge_cents, received_at, invoice_id")
      .eq("organization_id", organizationId)
      .or(`received_at.gte.${fromTs},invoice_id.not.is.null`),
    db
      .from("jobs")
      .select("id, pipeline, status, completed_at, final_crew_hours, final_materials_cents, final_other_cents, job_requested_services(service_type_id)")
      .eq("organization_id", organizationId)
      .gte("completed_at", `${addDays(today, -365)}T00:00:00Z`),
    db.from("organizations").select("crew_cost_per_hour").eq("id", organizationId).maybeSingle(),
    db.from("bank_accounts").select("current_balance, type, include, balance_at").eq("organization_id", organizationId),
    db.from("bank_transactions").select("amount, posted_on, name, merchant, category, pending").eq("organization_id", organizationId).gte("posted_on", ytd),
    db.from("team_payments").select("amount, status, paid_at, hours").eq("organization_id", organizationId).gte("paid_at", `${ytd}T00:00:00Z`),
    db.from("ledger_entries").select("direction, amount, occurred_on, category").eq("organization_id", organizationId).gte("occurred_on", ytd),
    db.from("job_proposals").select("status, responded_at").eq("organization_id", organizationId).in("status", ["accepted", "declined"]).gte("responded_at", `${addDays(today, -90)}T00:00:00Z`),
    db.from("autopay_charges").select("stripe_invoice_id, error, attempted_at").eq("organization_id", organizationId).eq("status", "failed").gte("attempted_at", `${addDays(today, -30)}T00:00:00Z`),
    listAutopayClients(organizationId).catch(() => [] as AutopayClient[]),
    qboSyncStatus(organizationId).catch(() => ({ lastRun: null, mapped: { customer: 0, invoice: 0, payment: 0 }, errors: [] }) as QboSyncStatus),
    getIntegration(organizationId, "quickbooks"),
  ]);

  // ---- Invoices, both kinds: Stripe ones the app raised and uploaded ones.
  type Inv = { id: string; job_id: string; amount: number; status: string; sent_at: string | null; created_at: string; hosted_invoice_url: string | null; jobs: { name: string | null; properties: { customers: { name: string } | null } | null } | null };
  type CInv = { id: string; amount: number | null; issued_on: string | null; due_on: string | null; paid_on: string | null; title: string | null; invoice_number: string | null; customers: { name: string } | null };
  type Pay = { amount_cents: number; surcharge_cents: number | null; received_at: string; invoice_id: string | null };
  const invs = (invRows ?? []) as unknown as Inv[];
  const cinvs = (clientInvRows ?? []) as unknown as CInv[];
  const pays = (payRows ?? []) as Pay[];

  const paidAgainst = new Map<string, number>();
  for (const p of pays) if (p.invoice_id) paidAgainst.set(p.invoice_id, (paidAgainst.get(p.invoice_id) ?? 0) + p.amount_cents / 100);

  const invoicedItems = [
    ...invs.map((i) => ({ day: localDay(i.sent_at ?? i.created_at), amount: Number(i.amount) })),
    ...cinvs.filter((c) => c.issued_on && c.amount).map((c) => ({ day: c.issued_on!, amount: Number(c.amount) })),
  ];
  const collectedItems = pays.map((p) => ({ day: localDay(p.received_at), amount: (p.amount_cents - (p.surcharge_cents ?? 0)) / 100 }));
  const total = (items: { day: string; amount: number }[], a: string, b: string) => sum(items.filter((i) => inRange(i.day, a, b)).map((i) => i.amount));

  const revenue = Object.fromEntries(
    (["week", "month", "ytd"] as Period[]).map((p) => [p, { invoiced: total(invoicedItems, periodStart(today, p), today), collected: total(collectedItems, periodStart(today, p), today) }])
  ) as FinanceDashboard["revenue"];

  // ---- AR aging and DSO.
  const open: ArInvoice[] = [
    ...invs
      .filter((i) => i.status === "open")
      .map((i) => ({
        id: i.id,
        customerName: i.jobs?.properties?.customers?.name ?? i.jobs?.name ?? "Client",
        amount: Number(i.amount),
        issuedOn: localDay(i.sent_at ?? i.created_at),
        hostedUrl: i.hosted_invoice_url,
      })),
    ...cinvs
      .filter((c) => !c.paid_on && c.amount && c.issued_on)
      .map((c) => ({
        id: c.id,
        customerName: c.customers?.name ?? c.title ?? "Client",
        amount: r2(Math.max(0, Number(c.amount) - (paidAgainst.get(c.id) ?? 0))),
        issuedOn: c.issued_on!,
        dueOn: c.due_on,
      })),
  ];
  const aging = arAging(open, today);
  const lateFeeSettings = {
    enabled: settings.lateFeeEnabled,
    startedAt: settings.lateFeeStartedAt,
    kind: settings.lateFeeKind,
    amount: settings.lateFeeAmount,
    graceDays: settings.lateFeeGraceDays,
  };
  const lateFees = sum(open.map((i) => lateFeeFor(i, lateFeeSettings, today)));
  const dsoDays = dso(aging.total, total(invoicedItems, addDays(today, -89), today), 90);

  // ---- Gross margin by division, from finished jobs with final costs.
  const crewRate = Number((org as { crew_cost_per_hour: number | null } | null)?.crew_cost_per_hour ?? 0);
  type JobRow = { id: string; pipeline: string; final_crew_hours: number | null; final_materials_cents: number | null; final_other_cents: number | null; completed_at: string | null; job_requested_services: { service_type_id: string }[] | null };
  const jobs = ((jobRows ?? []) as unknown as JobRow[]).filter((j) => (j.final_crew_hours ?? 0) > 0);
  const typeIds = [...new Set(jobs.flatMap((j) => (j.job_requested_services ?? []).map((s) => s.service_type_id)))];
  const { data: svc } = typeIds.length ? await db.from("services").select("service_type_id, name").in("service_type_id", typeIds) : { data: [] };
  const svcName = new Map(((svc ?? []) as { service_type_id: string; name: string }[]).map((s) => [s.service_type_id, s.name]));
  const priceByJob = new Map<string, number>();
  const { data: jobInvs } = jobs.length
    ? await db.from("invoices").select("job_id, amount").in("job_id", jobs.map((j) => j.id)).neq("status", "void")
    : { data: [] };
  for (const i of (jobInvs ?? []) as { job_id: string; amount: number }[]) priceByJob.set(i.job_id, (priceByJob.get(i.job_id) ?? 0) + Number(i.amount));
  const costed: (CostedJob & { completedOn: string; hours: number })[] = jobs
    .filter((j) => (priceByJob.get(j.id) ?? 0) > 0)
    .map((j) => ({
      division: divisionOf((j.job_requested_services ?? []).map((s) => svcName.get(s.service_type_id) ?? ""), j.pipeline),
      price: priceByJob.get(j.id) ?? 0,
      labour: (j.final_crew_hours ?? 0) * crewRate,
      materials: (j.final_materials_cents ?? 0) / 100,
      other: (j.final_other_cents ?? 0) / 100,
      completedOn: j.completed_at ? localDay(j.completed_at) : today,
      hours: j.final_crew_hours ?? 0,
    }));
  const margins = marginsByDivision(costed);

  // ---- Cash, spend, labour, net.
  type Acct = { current_balance: number | null; type: string | null; include: boolean; balance_at: string | null };
  const banks = ((accounts ?? []) as Acct[]).filter((a) => a.include && (a.type ?? "depository") === "depository");
  const plaidLinked = isPlaidConfigured && banks.length > 0;
  const cash = {
    connected: plaidLinked,
    live: isPlaidLive,
    balance: plaidLinked ? sum(banks.map((a) => Number(a.current_balance ?? 0))) : null,
    asOf: banks.map((a) => a.balance_at).filter(Boolean).sort().pop() ?? null,
    accounts: banks.length,
  };

  type Txn = { amount: number; posted_on: string; name: string | null; merchant: string | null; category: string | null; pending: boolean };
  const outflows = ((txns ?? []) as Txn[]).filter((t) => !t.pending && t.amount > 0);
  const collectedYtd = revenue.ytd.collected;
  const collectedMonth = revenue.month.collected;
  const marketingYtd = sum(outflows.filter((t) => isMarketingCharge(t.merchant ?? t.name)).map((t) => t.amount));

  const monthStart = periodStart(today, "month");
  type TeamPay = { amount: number; status: string; paid_at: string | null; hours: number | null };
  const paidTeam = ((teamPays ?? []) as TeamPay[]).filter((p) => p.status === "paid" && p.paid_at && localDay(p.paid_at) >= monthStart);
  let laborMonth = sum(paidTeam.map((p) => Number(p.amount)));
  let laborNote = "Team payments recorded this month.";
  if (laborMonth === 0) {
    const hoursMonth = costed.filter((j) => j.completedOn >= monthStart).reduce((s, j) => s + j.hours, 0);
    laborMonth = r2(hoursMonth * crewRate);
    laborNote = "Estimated: final crew hours this month × crew cost per hour (no team payments recorded).";
  }

  let expensesYtd: number | null = null;
  let netNote = "";
  if (plaidLinked && isPlaidLive) {
    expensesYtd = sum(outflows.filter((t) => isOperatingExpense(t.category)).map((t) => t.amount));
    netNote = "Collected minus bank spending (transfers and loan payments left out). An estimate until the books close in QuickBooks.";
  } else {
    const outs = ((ledger ?? []) as { direction: string; amount: number }[]).filter((l) => l.direction === "out");
    if (outs.length) {
      expensesYtd = sum(outs.map((l) => Number(l.amount)));
      netNote = "Collected minus expenses entered in the ledger. Connect the bank (Plaid) for every expense.";
    }
  }
  const marketingPct = plaidLinked ? pct(marketingYtd, collectedYtd) : null;
  const laborPct = pct(laborMonth, collectedMonth);
  const netPct = expensesYtd !== null && collectedYtd > 0 ? r2(((collectedYtd - expensesYtd) / collectedYtd) * 100) : null;
  const ratios = {
    marketing: {
      label: "Marketing spend, year to date",
      value: marketingPct,
      unit: "%" as const,
      tone: toneFor(marketingPct, BANDS.marketingPct),
      target: BANDS.marketingPct.label,
      note: plaidLinked ? `$${marketingYtd.toLocaleString()} to ad, print and lead-gen merchants in the bank feed.` : "Not connected — link the bank (Plaid) to see marketing spend.",
    },
    labor: { label: "Labor, this month", value: laborPct, unit: "%" as const, tone: toneFor(laborPct, BANDS.laborPct), target: BANDS.laborPct.label, note: laborNote },
    net: {
      label: "Net margin, year to date",
      value: netPct,
      unit: "%" as const,
      tone: toneFor(netPct, BANDS.netMarginPct),
      target: BANDS.netMarginPct.label,
      note: netNote || "No expenses to compare against yet — link the bank (Plaid) or record expenses in the ledger.",
    },
  };

  // ---- Weekly scorecard: last full week (Monday–Sunday).
  const lastWeekStart = addDays(mondayOf(today), -7);
  const lastWeekEnd = addDays(lastWeekStart, 6);
  const weeklyAvg = (items: { day: string; amount: number }[]) => {
    const start = addDays(lastWeekStart, -7 * 12);
    return r2(total(items, start, lastWeekEnd) / 13);
  };
  const collectedLastWeek = total(collectedItems, lastWeekStart, lastWeekEnd);
  const invoicedLastWeek = total(invoicedItems, lastWeekStart, lastWeekEnd);
  const recent = costed.filter((j) => j.completedOn >= addDays(today, -90));
  const recentRevenue = sum(recent.map((j) => j.price));
  const recentGp = sum(recent.map((j) => j.price - j.labour - j.materials - j.other));
  const grossPct = pct(recentGp, recentRevenue);
  const last28 = costed.filter((j) => j.completedOn >= addDays(today, -28));
  const hours28 = last28.reduce((s, j) => s + j.hours, 0);
  const revPerHour = hours28 > 0 ? Math.round(sum(last28.map((j) => j.price)) / hours28) : null;
  const finished30 = ((jobRows ?? []) as unknown as JobRow[]).filter((j) => j.completed_at && localDay(j.completed_at) >= addDays(today, -30));
  const finalHoursPct = pct(finished30.filter((j) => (j.final_crew_hours ?? 0) > 0).length, finished30.length);
  const decided = (proposals ?? []) as { status: string }[];
  const closePct = pct(decided.filter((p) => p.status === "accepted").length, decided.length);
  const recurring = autopay.filter((a) => a.recurring);
  const autopayPct = pct(recurring.filter((a) => a.enabled && a.confirmedAt).length, recurring.length);
  const over30Pct = pct(aging.over30, aging.total);
  const money = (n: number | null) => (n === null ? "—" : `$${Math.round(n).toLocaleString()}`);
  const pctText = (n: number | null) => (n === null ? "—" : `${n}%`);

  const scorecard: ScorecardMetric[] = [
    { key: "collected", label: "Cash collected last week", value: money(collectedLastWeek), tone: trendTone(collectedLastWeek, weeklyAvg(collectedItems)), target: `13-week average ${money(weeklyAvg(collectedItems))}`, owner: "Owner" },
    { key: "invoiced", label: "Invoiced last week", value: money(invoicedLastWeek), tone: trendTone(invoicedLastWeek, weeklyAvg(invoicedItems)), target: `13-week average ${money(weeklyAvg(invoicedItems))}`, owner: "Office" },
    { key: "gross", label: "Gross margin, jobs finished in 90 days", value: pctText(grossPct), tone: toneFor(grossPct, BANDS.grossCompany), target: BANDS.grossCompany.label, owner: "Project lead", note: recent.length ? `${recent.length} costed jobs` : "No job costing yet" },
    { key: "labor", label: "Labor % of revenue (month)", value: pctText(laborPct), tone: ratios.labor.tone, target: BANDS.laborPct.label, owner: "Project lead" },
    { key: "marketing", label: "Marketing % of revenue (YTD)", value: pctText(marketingPct), tone: ratios.marketing.tone, target: BANDS.marketingPct.label, owner: "Marketing lead" },
    { key: "net", label: "Net margin (YTD, estimate)", value: pctText(netPct), tone: ratios.net.tone, target: BANDS.netMarginPct.label, owner: "Owner" },
    { key: "over30", label: "AR over 30 days", value: `${money(aging.over30)}${over30Pct !== null ? ` (${over30Pct}%)` : ""}`, tone: aging.total > 0 ? toneFor(over30Pct, BANDS.over30Pct) : "good", target: BANDS.over30Pct.label, owner: "Office" },
    { key: "dso", label: "Days sales outstanding", value: dsoDays === null ? "—" : `${dsoDays} days`, tone: toneFor(dsoDays, dsoBand(settings.dsoTargetDays)), target: `Under ${settings.dsoTargetDays} days`, owner: "Office" },
    { key: "autopay", label: "Recurring clients on autopay", value: pctText(autopayPct), tone: toneFor(autopayPct, BANDS.autopayPct), target: BANDS.autopayPct.label, owner: "Account manager" },
    { key: "close", label: "Close rate, last 90 days", value: pctText(closePct), tone: toneFor(closePct, BANDS.closeRatePct), target: BANDS.closeRatePct.label, owner: "Sales lead", note: `${decided.length} decided` },
    { key: "revhour", label: "Revenue per crew hour (4 weeks)", value: revPerHour === null ? "—" : `$${revPerHour}`, tone: toneFor(revPerHour, BANDS.revPerHour), target: BANDS.revPerHour.label, owner: "Project lead" },
    { key: "finalhours", label: "Finished jobs with final hours", value: pctText(finalHoursPct), tone: toneFor(finalHoursPct, BANDS.finalHoursPct), target: BANDS.finalHoursPct.label, owner: "Project lead", note: `${finished30.length} finished in 30 days` },
  ];

  // ---- Needs you.
  const needsYou: NeedsYou[] = [];
  const failed = (failedCharges ?? []) as { stripe_invoice_id: string; error: string | null }[];
  if (failed.length) needsYou.push({ key: "autopay", tone: "bad", text: `${failed.length} autopay charge${failed.length === 1 ? "" : "s"} failed in the last 30 days — ask the client to update their card or bank.` });
  const late60 = aging.rows.filter((r) => r.daysLate > 30);
  if (late60.length) needsYou.push({ key: "late", tone: "bad", text: `${late60.length} invoice${late60.length === 1 ? " is" : "s are"} more than 30 days past due (${money(sum(late60.map((r) => r.amount)))}).` });
  if (settings.qboSyncEnabled && qbo.errors.length) needsYou.push({ key: "qbo", tone: "warn", text: `${qbo.errors.length} record${qbo.errors.length === 1 ? "" : "s"} didn't reach QuickBooks — see QuickBooks sync below.` });
  if (settings.qboSyncEnabled && qboRow?.status === "error") needsYou.push({ key: "qbo-auth", tone: "bad", text: `QuickBooks needs reconnecting: ${qboRow.last_error ?? "sign-in expired"}.` });

  return {
    today,
    settings,
    needsYou,
    revenue,
    aging: { ...aging, lateFees },
    dso: dsoDays,
    margins,
    costedJobs: costed.length,
    cash,
    ratios,
    scorecard,
    autopay,
    qbo: { ...qbo, connected: Boolean(qboRow && qboRow.status === "connected"), enabled: settings.qboSyncEnabled },
  };
}
