import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { canDoEvaluations } from "@/lib/affiliate-roles";
import { agreedTotal } from "@/lib/agreed-total";
import { splitRepayment } from "@/lib/commission-advance";
import { log, describeError } from "@/lib/log";
import type { JobRoles, PoolRole } from "@/lib/commission-split";
import {
  accrualsForPayment,
  affiliateRateMismatches,
  buildStatements,
  grossMarginPct,
  lastCompletedWeek,
  payableNow,
  type JobGate,
  type OpenAccrual,
  type RateDefaults,
  type RateMismatch,
} from "@/lib/commissions/accrual";
import { afterStart, loadBackOfficeSettingsAdmin, type BackOfficeSettings } from "@/lib/data/back-office-settings";

/**
 * The database side of commissions that accrue themselves: write the rows
 * when money lands, batch the payable ones each week, record the payouts
 * when the owner approves the total.
 *
 * Runs as the service role: the webhook and the cron have nobody signed in.
 * Every write is idempotent. An accrual is unique per payment, person, share
 * and portion; a batch is unique per week; approving moves a batch out of
 * "awaiting approval" in one conditional update, so a double tap pays once.
 */

type Admin = SupabaseClient;
const admin = (): Admin => createAdminClient() as unknown as Admin;

/** The reference every weekly payout is written under, so hand payments can be told apart. */
export const STATEMENT_REFERENCE_PREFIX = "Weekly statement";

const OWNER_ROLES = ["admin", "owner"];
const SOLD = new Set(["approved", "scheduled", "in_progress", "completed"]);

interface JobRow {
  id: string;
  organization_id: string;
  status: string;
  assigned_to: string | null;
  referred_by_profile_id: string | null;
  referral_code: string | null;
  created_at: string;
  completed_at: string | null;
  final_crew_hours: number | null;
  final_materials_cents: number | null;
  final_other_cents: number | null;
  property: { customer: { account_manager_id: string | null; name: string | null } | null } | null;
}

export interface AccrualContext {
  jobs: Map<string, JobRow>;
  roles: Map<string, JobRoles>;
  soldAt: Map<string, string | null>;
  priceCents: Map<string, number>;
  owners: Set<string>;
  splitFrom: string;
  ratesOnFile: Map<string, number>;
  legacyPct: Map<string, number | null>;
  names: Map<string, string>;
  openTickets: Map<string, number>;
  designIssues: Map<string, number>;
}

/** Everything working out who earns what on these jobs needs, in a handful of queries. */
export async function loadAccrualContext(organizationId: string, jobIds: string[]): Promise<AccrualContext> {
  const sb = admin();
  const ids = [...new Set(jobIds)].filter(Boolean);
  const [jobsRes, profilesRes, rolesRes, orgRes, linksRes, ratesRes, proposalsRes, ticketsRes] = await Promise.all([
    ids.length
      ? sb
          .from("jobs")
          .select(
            "id, organization_id, status, assigned_to, referred_by_profile_id, referral_code, created_at, completed_at, final_crew_hours, final_materials_cents, final_other_cents, property:properties(customer:customers(account_manager_id, name))"
          )
          .in("id", ids)
      : Promise.resolve({ data: [] }),
    sb.from("profiles").select("id, full_name, email, commission_pct, does_evaluations").eq("organization_id", organizationId),
    sb.from("profile_roles").select("profile_id, role_name"),
    sb.from("organizations").select("commission_split_from").eq("id", organizationId).maybeSingle(),
    sb.from("outreach_links").select("code, profile_id").eq("organization_id", organizationId),
    sb.from("commission_rates").select("profile_id, role, pct").eq("organization_id", organizationId),
    ids.length ? sb.from("job_proposals").select("job_id, status, responded_at, approved_at, total_cost, discount_amount").in("job_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? sb.from("job_tickets").select("job_id, status, cause").in("job_id", ids) : Promise.resolve({ data: [] }),
  ]);

  const rolesOf = new Map<string, string[]>();
  for (const r of (rolesRes.data ?? []) as { profile_id: string; role_name: string }[]) {
    rolesOf.set(r.profile_id, [...(rolesOf.get(r.profile_id) ?? []), r.role_name]);
  }
  const people = (profilesRes.data ?? []) as { id: string; full_name: string | null; email: string | null; commission_pct: number | string | null; does_evaluations: boolean | null }[];
  const inOrg = new Set(people.map((p) => p.id));
  const owners = new Set(people.filter((p) => (rolesOf.get(p.id) ?? []).some((r) => OWNER_ROLES.includes(r.toLowerCase().trim()))).map((p) => p.id));
  const evaluates = new Set(people.filter((p) => canDoEvaluations(rolesOf.get(p.id) ?? [], p.does_evaluations)).map((p) => p.id));
  const posterByCode = new Map(((linksRes.data ?? []) as { code: string; profile_id: string }[]).map((l) => [l.code, l.profile_id]));

  const jobs = new Map<string, JobRow>();
  const roles = new Map<string, JobRoles>();
  for (const job of (jobsRes.data ?? []) as unknown as JobRow[]) {
    jobs.set(job.id, job);
    const affiliate = job.referred_by_profile_id ?? (job.referral_code ? (posterByCode.get(job.referral_code) ?? null) : null);
    roles.set(job.id, {
      accountManagerId: job.property?.customer?.account_manager_id ?? null,
      evaluatorId: job.assigned_to && evaluates.has(job.assigned_to) ? job.assigned_to : null,
      affiliateId: affiliate && inOrg.has(affiliate) ? affiliate : null,
    });
  }

  const soldAt = new Map<string, string | null>();
  const priceCents = new Map<string, number>();
  for (const p of (proposalsRes.data ?? []) as { job_id: string; status: string | null; responded_at: string | null; approved_at: string | null; total_cost: number | null; discount_amount: number | null }[]) {
    const at = p.status === "accepted" ? (p.responded_at ?? p.approved_at) : null;
    const seen = soldAt.get(p.job_id);
    if (at && (!seen || at < seen)) soldAt.set(p.job_id, at);
    const total = agreedTotal(p);
    if (total != null) priceCents.set(p.job_id, Math.round(total * 100));
  }
  // Work booked before proposals were answered in the app was sold when it was booked.
  for (const job of jobs.values()) {
    if (!soldAt.has(job.id) && SOLD.has(job.status)) soldAt.set(job.id, job.created_at);
  }

  const openTickets = new Map<string, number>();
  const designIssues = new Map<string, number>();
  for (const t of (ticketsRes.data ?? []) as { job_id: string; status: string; cause: string | null }[]) {
    if (t.status === "open" || t.status === "scheduled") {
      openTickets.set(t.job_id, (openTickets.get(t.job_id) ?? 0) + 1);
      if (t.cause === "design") designIssues.set(t.job_id, (designIssues.get(t.job_id) ?? 0) + 1);
    }
  }

  return {
    jobs,
    roles,
    soldAt,
    priceCents,
    owners,
    splitFrom: ((orgRes.data as { commission_split_from?: string | null } | null)?.commission_split_from) ?? "2026-09-29",
    ratesOnFile: new Map(((ratesRes.data ?? []) as { profile_id: string; role: string; pct: number }[]).map((r) => [`${r.profile_id}:${r.role}`, Number(r.pct)])),
    legacyPct: new Map(people.map((p) => [p.id, p.commission_pct == null ? null : Number(p.commission_pct)])),
    names: new Map(people.map((p) => [p.id, p.full_name || p.email || "Somebody"])),
    openTickets,
    designIssues,
  };
}

export function rateDefaults(s: BackOfficeSettings): RateDefaults {
  return { account_manager: s.defaultAccountManagerPct, evaluator: s.defaultEvaluatorPct, affiliate: s.defaultAffiliatePct };
}

/**
 * Accrue commission on one payment against one job. Safe to call twice:
 * the unique key turns the second call into nothing.
 */
export async function accruePayment(input: {
  organizationId: string;
  jobId: string;
  sourceKey: string;
  amount: number;
  settings: BackOfficeSettings;
  context?: AccrualContext;
}): Promise<number> {
  const ctx = input.context ?? (await loadAccrualContext(input.organizationId, [input.jobId]));
  const job = ctx.jobs.get(input.jobId);
  if (!job || job.status === "cancelled") return 0;
  const rows = accrualsForPayment({
    amount: input.amount,
    roles: ctx.roles.get(job.id) ?? { accountManagerId: null, evaluatorId: null, affiliateId: null },
    soldAt: ctx.soldAt.get(job.id) ?? null,
    splitFrom: ctx.splitFrom,
    owners: ctx.owners,
    ratesOnFile: ctx.ratesOnFile,
    defaults: rateDefaults(input.settings),
    legacyPct: ctx.legacyPct,
    holdback: { on: input.settings.holdbackOn, collectPct: input.settings.holdbackCollectPct, marginPct: input.settings.holdbackMarginPct },
  });
  if (rows.length === 0) return 0;
  const { error } = await admin()
    .from("commission_accruals")
    .upsert(
      rows.map((r) => ({
        organization_id: input.organizationId,
        profile_id: r.profileId,
        job_id: job.id,
        role: r.role,
        source_key: input.sourceKey,
        base_amount: r.baseAmount,
        pct: r.pct,
        amount: r.amount,
        portion: r.portion,
        pay_on_collect: r.payOnCollect,
      })),
      { onConflict: "organization_id,source_key,profile_id,role,portion", ignoreDuplicates: true }
    );
  if (error) {
    log.error("commission.accrue_failed", error, { jobId: job.id, sourceKey: input.sourceKey });
    return 0;
  }
  return rows.length;
}

/**
 * The Stripe webhook's hook: invoice.paid on one of our job invoices.
 *
 * Never throws. A webhook that fails makes Stripe retry, and a commission
 * row is not worth a retried payment record. Anything missed is picked up
 * by the daily sweep.
 */
export async function accrueForStripeInvoice(stripeInvoiceId: string | null | undefined): Promise<void> {
  if (!stripeInvoiceId) return;
  try {
    const { data: invoice } = await admin()
      .from("invoices")
      .select("id, job_id, organization_id, amount")
      .eq("stripe_invoice_id", stripeInvoiceId)
      .maybeSingle();
    const inv = invoice as { id: string; job_id: string; organization_id: string; amount: number } | null;
    if (!inv?.job_id) return;
    const settings = await loadBackOfficeSettingsAdmin(inv.organization_id);
    if (!settings.commissionAccrualOn || !afterStart(new Date().toISOString(), settings.commissionAccrualStartedAt)) return;
    await accruePayment({
      organizationId: inv.organization_id,
      jobId: inv.job_id,
      sourceKey: `stripe_invoice:${stripeInvoiceId}`,
      amount: Number(inv.amount) || 0,
      settings,
    });
  } catch (err) {
    log.warn("commission.webhook_accrue_failed", { stripeInvoiceId, error: describeError(err) });
  }
}

/**
 * Catch up on money that landed since accrual was switched on and has no
 * rows yet: invoices paid while the webhook was down, and cash, cheques and
 * Stripe payments that were not one of our invoices. A payment that belongs
 * to one of our invoices is covered by that invoice and skipped, so nothing
 * is counted twice.
 */
export async function sweepAccruals(organizationId: string, settings: BackOfficeSettings): Promise<number> {
  const started = settings.commissionAccrualStartedAt;
  if (!settings.commissionAccrualOn || !started) return 0;
  const sb = admin();
  const [invoicesRes, paymentsRes, doneRes] = await Promise.all([
    sb.from("invoices").select("id, job_id, amount, stripe_invoice_id, paid_at, status").eq("organization_id", organizationId).gte("paid_at", started),
    sb.from("payments").select("id, job_id, amount_cents, surcharge_cents, invoice_id, stripe_invoice_id, received_at").eq("organization_id", organizationId).gte("received_at", started),
    sb.from("commission_accruals").select("source_key").eq("organization_id", organizationId).gte("created_at", started),
  ]);
  const done = new Set(((doneRes.data ?? []) as { source_key: string }[]).map((r) => r.source_key));
  const invoices = (invoicesRes.data ?? []) as { id: string; job_id: string; amount: number; stripe_invoice_id: string | null; paid_at: string | null; status: string }[];

  const todo: { jobId: string; key: string; amount: number }[] = [];
  const invoiceKeys = new Set<string>();
  for (const inv of invoices) {
    invoiceKeys.add(inv.id);
    if (inv.stripe_invoice_id) invoiceKeys.add(inv.stripe_invoice_id);
    const key = inv.stripe_invoice_id ? `stripe_invoice:${inv.stripe_invoice_id}` : `invoice:${inv.id}`;
    if (!done.has(key) && inv.job_id) todo.push({ jobId: inv.job_id, key, amount: Number(inv.amount) || 0 });
  }
  // A payment against an invoice paid before the switch is covered by that
  // invoice too, so look those up rather than accrue them as fresh money.
  const payments = (paymentsRes.data ?? []) as { id: string; job_id: string | null; amount_cents: number; surcharge_cents: number | null; invoice_id: string | null; stripe_invoice_id: string | null }[];
  const refs = [...new Set(payments.flatMap((p) => [p.invoice_id, p.stripe_invoice_id]).filter((x): x is string => Boolean(x)))].filter((r) => !invoiceKeys.has(r));
  if (refs.length) {
    const uuids = refs.filter((r) => /^[0-9a-f-]{36}$/i.test(r));
    const [byId, byStripe] = await Promise.all([
      uuids.length ? sb.from("invoices").select("id, stripe_invoice_id").in("id", uuids) : Promise.resolve({ data: [] }),
      sb.from("invoices").select("id, stripe_invoice_id").in("stripe_invoice_id", refs),
    ]);
    for (const r of [...((byId.data ?? []) as { id: string; stripe_invoice_id: string | null }[]), ...((byStripe.data ?? []) as { id: string; stripe_invoice_id: string | null }[])]) {
      invoiceKeys.add(r.id);
      if (r.stripe_invoice_id) invoiceKeys.add(r.stripe_invoice_id);
    }
  }
  for (const p of payments) {
    if (!p.job_id) continue;
    if ((p.invoice_id && invoiceKeys.has(p.invoice_id)) || (p.stripe_invoice_id && invoiceKeys.has(p.stripe_invoice_id))) continue;
    const key = `payment:${p.id}`;
    // The card fee is not money against the job.
    if (!done.has(key)) todo.push({ jobId: p.job_id, key, amount: (p.amount_cents - (p.surcharge_cents ?? 0)) / 100 });
  }
  if (todo.length === 0) return 0;

  const ctx = await loadAccrualContext(organizationId, todo.map((t) => t.jobId));
  let written = 0;
  for (const t of todo) {
    written += await accruePayment({ organizationId, jobId: t.jobId, sourceKey: t.key, amount: t.amount, settings, context: ctx });
  }
  return written;
}

export interface OpenAccrualRow {
  id: string;
  profile_id: string;
  job_id: string;
  role: PoolRole;
  portion: "collection" | "holdback";
  pay_on_collect: boolean;
  amount: number;
  status: string;
  hold_reason: string | null;
  created_at: string;
}

function gateFor(ctx: AccrualContext, jobId: string, settings: BackOfficeSettings): JobGate {
  const job = ctx.jobs.get(jobId);
  const price = ctx.priceCents.get(jobId) ?? 0;
  return {
    status: job?.status ?? "cancelled",
    openTickets: ctx.openTickets.get(jobId) ?? 0,
    designIssues: ctx.designIssues.get(jobId) ?? 0,
    marginPct: job
      ? grossMarginPct({
          priceCents: price,
          crewHours: job.final_crew_hours == null ? null : Number(job.final_crew_hours),
          crewCostPerHourCents: Math.round(settings.holdbackCrewCostPerHour * 100),
          materialsCents: job.final_materials_cents,
          otherCents: job.final_other_cents,
        })
      : null,
  };
}

/** Each open row, with whether it is payable now and why not. Also writes the reason back, for the panel. */
export async function evaluateOpenAccruals(
  organizationId: string,
  settings: BackOfficeSettings
): Promise<{ rows: (OpenAccrualRow & { payable: boolean; reason: string | null })[]; ctx: AccrualContext }> {
  const { data } = await admin()
    .from("commission_accruals")
    .select("id, profile_id, job_id, role, portion, pay_on_collect, amount, status, hold_reason, created_at")
    .eq("organization_id", organizationId)
    .eq("status", "accrued")
    .is("batch_id", null);
  const open = (data ?? []) as OpenAccrualRow[];
  const ctx = await loadAccrualContext(organizationId, open.map((r) => r.job_id));
  const rows = open.map((r) => {
    const verdict = payableNow({ role: r.role, portion: r.portion, payOnCollect: r.pay_on_collect }, gateFor(ctx, r.job_id, settings), { marginPct: settings.holdbackMarginPct });
    return { ...r, amount: Number(r.amount), ...verdict };
  });
  // Keep the reason on the row so the panel and the queue can say why.
  const changed = rows.filter((r) => (r.reason ?? null) !== (r.hold_reason ?? null));
  await Promise.all(changed.map((r) => admin().from("commission_accruals").update({ hold_reason: r.reason, updated_at: new Date().toISOString() }).eq("id", r.id)));
  return { rows, ctx };
}

/**
 * Commission recorded by hand on the Money page since accrual started, per
 * job and person, less what earlier statements already took off for it.
 */
async function unabsorbedHandPayments(organizationId: string, startedAt: string): Promise<Map<string, number>> {
  const sb = admin();
  const [payoutsRes, statementsRes] = await Promise.all([
    sb.from("commission_payouts").select("job_id, profile_id, amount, reference, advance_repayment").eq("organization_id", organizationId).gte("paid_at", startedAt),
    sb.from("commission_statements").select("profile_id, lines").eq("organization_id", organizationId),
  ]);
  const out = new Map<string, number>();
  for (const p of (payoutsRes.data ?? []) as { job_id: string; profile_id: string; amount: number; reference: string | null }[]) {
    if ((p.reference ?? "").startsWith(STATEMENT_REFERENCE_PREFIX)) continue;
    const key = `${p.job_id}:${p.profile_id}`;
    out.set(key, (out.get(key) ?? 0) + Number(p.amount));
  }
  for (const s of (statementsRes.data ?? []) as { profile_id: string; lines: { jobId: string; offset?: number }[] }[]) {
    for (const line of s.lines ?? []) {
      const key = `${line.jobId}:${s.profile_id}`;
      if (out.has(key)) out.set(key, (out.get(key) ?? 0) - Number(line.offset ?? 0));
    }
  }
  return out;
}

/**
 * The weekly batch: one statement per person for everything payable, one
 * total for the owner. Built once per week, any time after the week ends.
 * Returns the batch id, or null when there was nothing to pay or the week
 * already has its batch.
 */
export async function buildWeeklyBatch(organizationId: string, settings: BackOfficeSettings, now = new Date()): Promise<string | null> {
  if (!settings.commissionAccrualOn || !settings.commissionAccrualStartedAt) return null;
  const sb = admin();
  const { weekStart, weekEnd } = lastCompletedWeek(now);
  const { data: existing } = await sb.from("commission_payout_batches").select("id").eq("organization_id", organizationId).eq("week_start", weekStart).maybeSingle();
  if (existing) return null;

  const { rows, ctx } = await evaluateOpenAccruals(organizationId, settings);
  const cutoff = Date.parse(`${weekEnd}T23:59:59-05:00`);
  const payable: OpenAccrual[] = rows
    .filter((r) => r.payable && Date.parse(r.created_at) <= cutoff)
    .map((r) => ({ id: r.id, profileId: r.profile_id, jobId: r.job_id, amount: r.amount }));
  if (payable.length === 0) return null;

  const statements = buildStatements(payable, await unabsorbedHandPayments(organizationId, settings.commissionAccrualStartedAt));
  const total = Math.round(statements.reduce((s, st) => s + st.total, 0) * 100) / 100;

  const { data: batch, error } = await sb
    .from("commission_payout_batches")
    .insert({
      organization_id: organizationId,
      week_start: weekStart,
      week_end: weekEnd,
      total,
      people: statements.filter((s) => s.total > 0).length,
      // Everything payable was already paid by hand: nothing to approve, so
      // the week is settled as it is built rather than asking for a $0 yes.
      ...(total <= 0 ? { status: "approved", approved_at: new Date().toISOString() } : {}),
    })
    .select("id")
    .single();
  // Another run got there first.
  if (error || !batch) return null;
  const batchId = (batch as { id: string }).id;

  await sb.from("commission_statements").insert(
    statements.map((st) => ({
      organization_id: organizationId,
      batch_id: batchId,
      profile_id: st.profileId,
      total: st.total,
      lines: st.lines.map((l) => ({
        jobId: l.jobId,
        customer: ctx.jobs.get(l.jobId)?.property?.customer?.name ?? null,
        amount: l.amount,
        offset: l.offset,
        accrualIds: l.accrualIds,
      })),
    }))
  );
  await sb
    .from("commission_accruals")
    .update({ status: total <= 0 ? "paid" : "batched", batch_id: batchId, updated_at: new Date().toISOString() })
    .in("id", payable.map((p) => p.id))
    .eq("status", "accrued");
  log.info("commission.batch_built", { organizationId, weekStart, total, people: statements.length });
  return total > 0 ? batchId : null;
}

export interface BatchView {
  id: string;
  weekStart: string;
  weekEnd: string;
  total: number;
  status: string;
  approvedAt: string | null;
  statements: { profileId: string; name: string; total: number; lines: { jobId: string; customer: string | null; amount: number; offset: number }[] }[];
}

/** Batches for the panel, newest first, with each person's statement. */
export async function listBatches(organizationId: string, limit = 6): Promise<BatchView[]> {
  const sb = admin();
  const { data: batches } = await sb
    .from("commission_payout_batches")
    .select("id, week_start, week_end, total, status, approved_at")
    .eq("organization_id", organizationId)
    .order("week_start", { ascending: false })
    .limit(limit);
  const list = (batches ?? []) as { id: string; week_start: string; week_end: string; total: number; status: string; approved_at: string | null }[];
  if (list.length === 0) return [];
  const [{ data: statements }, { data: people }] = await Promise.all([
    sb.from("commission_statements").select("batch_id, profile_id, total, lines").in("batch_id", list.map((b) => b.id)),
    sb.from("profiles").select("id, full_name, email").eq("organization_id", organizationId),
  ]);
  const names = new Map(((people ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((p) => [p.id, p.full_name || p.email || "Somebody"]));
  return list.map((b) => ({
    id: b.id,
    weekStart: b.week_start,
    weekEnd: b.week_end,
    total: Number(b.total),
    status: b.status,
    approvedAt: b.approved_at,
    statements: ((statements ?? []) as { batch_id: string; profile_id: string; total: number; lines: { jobId: string; customer: string | null; amount: number; offset?: number }[] }[])
      .filter((s) => s.batch_id === b.id)
      .map((s) => ({
        profileId: s.profile_id,
        name: names.get(s.profile_id) ?? "Somebody",
        total: Number(s.total),
        lines: (s.lines ?? []).map((l) => ({ jobId: l.jobId, customer: l.customer ?? null, amount: Number(l.amount), offset: Number(l.offset ?? 0) })),
      }))
      .sort((a, c) => c.total - a.total),
  }));
}

/**
 * The owner said yes to the week's total: write each person's payouts.
 *
 * One commission_payouts row per job per person, as the Money page has
 * always recorded them, so every existing screen reads the week as paid. An
 * advance somebody owes is paid back first, exactly as a hand payment does.
 *
 * The batch moves out of "awaiting approval" in one conditional update
 * before anything is written: a second tap, or the queue and the panel both
 * approving, finds nothing left to approve.
 */
export async function approveBatch(input: { organizationId: string; batchId: string; approverId: string }): Promise<{ ok: true; total: number } | { ok: false; error: string }> {
  const sb = admin();
  const now = new Date().toISOString();
  const { data: claimed, error } = await sb
    .from("commission_payout_batches")
    .update({ status: "approved", approved_by: input.approverId, approved_at: now })
    .eq("id", input.batchId)
    .eq("organization_id", input.organizationId)
    .eq("status", "awaiting_approval")
    .select("id, week_start, total")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!claimed) return { ok: false, error: "That week has already been approved." };
  const batch = claimed as { id: string; week_start: string; total: number };

  const { data: statements } = await sb.from("commission_statements").select("profile_id, lines").eq("batch_id", batch.id);
  const list = (statements ?? []) as { profile_id: string; lines: { jobId: string; amount: number }[] }[];
  const profileIds = list.map((s) => s.profile_id);

  // What each person still owes on advances: paid advances less what has been kept back already.
  const owed = new Map<string, number>();
  if (profileIds.length) {
    const [{ data: paid }, { data: repaid }] = await Promise.all([
      sb.from("commission_advances").select("profile_id, amount").eq("status", "paid").in("profile_id", profileIds),
      sb.from("commission_payouts").select("profile_id, amount").eq("advance_repayment", true).in("profile_id", profileIds),
    ]);
    for (const a of (paid ?? []) as { profile_id: string; amount: number }[]) owed.set(a.profile_id, (owed.get(a.profile_id) ?? 0) + Number(a.amount));
    for (const r of (repaid ?? []) as { profile_id: string; amount: number }[]) owed.set(r.profile_id, (owed.get(r.profile_id) ?? 0) - Number(r.amount));
  }

  const reference = `${STATEMENT_REFERENCE_PREFIX} ${batch.week_start}`;
  const rows = list.flatMap((s) =>
    splitRepayment(
      (s.lines ?? []).filter((l) => Number(l.amount) > 0).map((l) => ({ jobId: l.jobId, amount: Number(l.amount) })),
      Math.max(0, owed.get(s.profile_id) ?? 0)
    ).flatMap((line) => [
      ...(line.repay > 0
        ? [{ organization_id: input.organizationId, profile_id: s.profile_id, job_id: line.jobId, amount: line.repay, paid_at: now, method: "Advance repaid", reference, note: "Kept to pay back an advance", recorded_by: input.approverId, advance_repayment: true }]
        : []),
      ...(line.cash > 0
        ? [{ organization_id: input.organizationId, profile_id: s.profile_id, job_id: line.jobId, amount: line.cash, paid_at: now, method: "Weekly statement", reference, note: null, recorded_by: input.approverId, advance_repayment: false }]
        : []),
    ])
  );
  if (rows.length) {
    const { error: insertError } = await sb.from("commission_payouts").insert(rows);
    if (insertError) {
      // Put the batch back so it can be approved again once whatever failed is fixed.
      await sb.from("commission_payout_batches").update({ status: "awaiting_approval", approved_by: null, approved_at: null }).eq("id", batch.id);
      return { ok: false, error: insertError.message };
    }
  }
  await sb.from("commission_accruals").update({ status: "paid", updated_at: now }).eq("batch_id", batch.id).eq("status", "batched");
  log.info("commission.batch_approved", { organizationId: input.organizationId, batchId: batch.id, total: batch.total });
  return { ok: true, total: Number(batch.total) };
}

/** Affiliates whose rate on file is not the business default. */
export async function rateMismatches(organizationId: string, settings: BackOfficeSettings): Promise<RateMismatch[]> {
  const sb = admin();
  const [{ data: people }, { data: rates }] = await Promise.all([
    sb.from("profiles").select("id, full_name, email, is_affiliate, commission_pct").eq("organization_id", organizationId),
    sb.from("commission_rates").select("profile_id, role, pct").eq("organization_id", organizationId),
  ]);
  return affiliateRateMismatches(
    ((people ?? []) as { id: string; full_name: string | null; email: string | null; is_affiliate: boolean | null; commission_pct: number | string | null }[]).map((p) => ({
      id: p.id,
      name: p.full_name || p.email || "Somebody",
      isAffiliate: Boolean(p.is_affiliate),
      commissionPct: p.commission_pct == null ? null : Number(p.commission_pct),
    })),
    new Map(((rates ?? []) as { profile_id: string; role: string; pct: number }[]).map((r) => [`${r.profile_id}:${r.role}`, Number(r.pct)])),
    settings.defaultAffiliatePct
  );
}

export interface PersonAccrual {
  profileId: string;
  name: string;
  payable: number;
  waiting: number;
  reasons: string[];
}

/** Commission rows still waiting for a statement, summed per person, for the panel. */
export async function accrualSummary(organizationId: string, settings: BackOfficeSettings): Promise<PersonAccrual[]> {
  const { rows, ctx } = await evaluateOpenAccruals(organizationId, settings);
  const byPerson = new Map<string, { profileId: string; name: string; payable: number; waiting: number; reasons: Set<string> }>();
  for (const r of rows) {
    const p = byPerson.get(r.profile_id) ?? { profileId: r.profile_id, name: ctx.names.get(r.profile_id) ?? "Somebody", payable: 0, waiting: 0, reasons: new Set<string>() };
    if (r.payable) p.payable += r.amount;
    else {
      p.waiting += r.amount;
      if (r.reason) p.reasons.add(r.reason);
    }
    byPerson.set(r.profile_id, p);
  }
  return [...byPerson.values()]
    .map((p) => ({ ...p, payable: Math.round(p.payable * 100) / 100, waiting: Math.round(p.waiting * 100) / 100, reasons: [...p.reasons] }))
    .sort((a, b) => b.payable + b.waiting - (a.payable + a.waiting));
}
