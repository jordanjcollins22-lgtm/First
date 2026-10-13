"use server";

import { revalidatePath } from "next/cache";

import { outboundBaseUrl } from "@/lib/base-url";
import { financeDb, getFinanceSettings, saveFinanceSettings } from "@/lib/data/finance-settings";
import { loadPayrollWeek, payrollFile } from "@/lib/data/payroll";
import { getRealProfile } from "@/lib/data/team";
import { sendEmail } from "@/lib/email/send";
import { createAutopaySetup, sendAutopaySetup } from "@/lib/finance/autopay";
import { mondayOf } from "@/lib/finance/dates";
import { runQboSync } from "@/lib/integrations/quickbooks/sync";
import { log } from "@/lib/log";
import { isOwnerLevel } from "@/lib/roles";

/**
 * The Finance page's buttons: invoicing and collections settings, autopay
 * per client, the QuickBooks sync and the payroll file. Owner only.
 */

export type FinanceResult<T = undefined> = { ok: true; message: string; data?: T } | { ok: false; error: string };

async function owner() {
  const me = await getRealProfile();
  if (!me || !isOwnerLevel(me.roles)) return null;
  return me;
}

const done = () => revalidatePath("/v2/admin");
const NOT_OWNER = { ok: false as const, error: "Only an owner can change finance settings." };

export interface FinanceSettingsInput {
  autopayEnabled?: boolean;
  offerAch?: boolean;
  lateFeeEnabled?: boolean;
  lateFeeKind?: "percent" | "flat";
  lateFeeAmount?: number;
  lateFeeGraceDays?: number;
  dsoTargetDays?: number;
  qboSyncEnabled?: boolean;
  /** "YYYY-MM-DD": push records from this day on. Earlier than switching on means a deliberate backfill. */
  qboSyncFrom?: string | null;
}

export async function saveFinanceSettingsAction(input: FinanceSettingsInput): Promise<FinanceResult> {
  const me = await owner();
  if (!me) return NOT_OWNER;
  const patch: Record<string, unknown> = {};
  if (input.autopayEnabled !== undefined) patch.autopay_enabled = Boolean(input.autopayEnabled);
  if (input.offerAch !== undefined) patch.offer_ach = Boolean(input.offerAch);
  if (input.lateFeeEnabled !== undefined) patch.late_fee_enabled = Boolean(input.lateFeeEnabled);
  if (input.lateFeeKind !== undefined) {
    if (input.lateFeeKind !== "percent" && input.lateFeeKind !== "flat") return { ok: false, error: "Late fee is a percent or a flat amount." };
    patch.late_fee_kind = input.lateFeeKind;
  }
  if (input.lateFeeAmount !== undefined) {
    const n = Number(input.lateFeeAmount);
    if (!Number.isFinite(n) || n < 0 || n > 500) return { ok: false, error: "That late fee doesn't look right." };
    patch.late_fee_amount = n;
  }
  if (input.lateFeeGraceDays !== undefined) {
    const n = Math.round(Number(input.lateFeeGraceDays));
    if (!Number.isFinite(n) || n < 0 || n > 120) return { ok: false, error: "Grace days must be 0–120." };
    patch.late_fee_grace_days = n;
  }
  if (input.dsoTargetDays !== undefined) {
    const n = Math.round(Number(input.dsoTargetDays));
    if (!Number.isFinite(n) || n < 1 || n > 180) return { ok: false, error: "DSO target must be 1–180 days." };
    patch.dso_target_days = n;
  }
  if (input.qboSyncEnabled !== undefined) patch.qbo_sync_enabled = Boolean(input.qboSyncEnabled);
  if (input.qboSyncFrom !== undefined) {
    if (input.qboSyncFrom && !/^\d{4}-\d{2}-\d{2}$/.test(input.qboSyncFrom)) return { ok: false, error: "Pick a date." };
    patch.qbo_sync_from = input.qboSyncFrom ? `${input.qboSyncFrom}T00:00:00-05:00` : null;
  }
  try {
    await saveFinanceSettings(me.organization_id, patch, me.id);
    done();
    return { ok: true, message: "Saved." };
  } catch (err) {
    log.error("finance.settings.save_failed", err);
    return { ok: false, error: "Couldn't save. Is migration 0363 applied?" };
  }
}

export async function runQboSyncNowAction(): Promise<FinanceResult> {
  const me = await owner();
  if (!me) return NOT_OWNER;
  try {
    const out = await runQboSync(me.organization_id, "manual");
    done();
    return out.ran && out.failed === 0 ? { ok: true, message: out.summary } : { ok: false, error: out.summary };
  } catch (err) {
    log.error("qbo.sync.manual_failed", err);
    return { ok: false, error: "The sync crashed; see logs." };
  }
}

/** Puts a client on autopay or takes them off. Off stops any future charge at once. */
export async function setAutopayAction(customerId: string, enabled: boolean): Promise<FinanceResult> {
  const me = await owner();
  if (!me) return NOT_OWNER;
  const { error } = await financeDb()
    .from("customer_autopay")
    .upsert({ organization_id: me.organization_id, customer_id: customerId, enabled, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: "Couldn't save. Is migration 0363 applied?" };
  done();
  return { ok: true, message: enabled ? "On autopay once they save a card or bank." : "Off autopay." };
}

/** Makes the client's setup page and returns its address, to copy into a text or email. */
export async function autopayLinkAction(customerId: string): Promise<FinanceResult<{ url: string }>> {
  const me = await owner();
  if (!me) return NOT_OWNER;
  try {
    const out = await createAutopaySetup(me.organization_id, customerId, await outboundBaseUrl());
    if ("error" in out) return { ok: false, error: out.error };
    done();
    return { ok: true, message: "Link made.", data: { url: out.url } };
  } catch (err) {
    log.error("autopay.link_failed", err);
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't make the link." };
  }
}

/** Makes the setup page and emails it to the client (consent and the message log apply). */
export async function sendAutopayLinkAction(customerId: string): Promise<FinanceResult> {
  const me = await owner();
  if (!me) return NOT_OWNER;
  try {
    const out = await createAutopaySetup(me.organization_id, customerId, await outboundBaseUrl());
    if ("error" in out) return { ok: false, error: out.error };
    // One email per setup page: pressing Send twice on the same page sends once.
    const sent = await sendAutopaySetup(me.organization_id, customerId, out.url, new URL(out.url).pathname.split("/").pop() ?? out.url);
    done();
    return sent.ok ? { ok: true, message: "Emailed." } : { ok: false, error: `Not sent: ${sent.message}` };
  } catch (err) {
    log.error("autopay.send_failed", err);
    return { ok: false, error: "Couldn't send it." };
  }
}

/** Each person's id at the payroll provider (Gusto employee ID or ADP file #). */
export async function savePayrollIdsAction(ids: Record<string, string>): Promise<FinanceResult> {
  const me = await owner();
  if (!me) return NOT_OWNER;
  const current = await getFinanceSettings(me.organization_id);
  const next: Record<string, string> = { ...current.payrollIds };
  for (const [k, v] of Object.entries(ids)) {
    const clean = v.trim().slice(0, 40);
    if (clean) next[k] = clean;
    else delete next[k];
  }
  try {
    await saveFinanceSettings(me.organization_id, { payroll_ids: next }, me.id);
    done();
    return { ok: true, message: "Saved." };
  } catch {
    return { ok: false, error: "Couldn't save. Is migration 0363 applied?" };
  }
}

function weekOf(weekStart: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(weekStart) ? mondayOf(weekStart) : null;
}

export async function payrollFileAction(weekStart: string, format?: "gusto" | "adp"): Promise<FinanceResult<{ filename: string; csv: string }>> {
  const me = await owner();
  if (!me) return NOT_OWNER;
  const week = weekOf(weekStart);
  if (!week) return { ok: false, error: "Pick a week." };
  const view = await loadPayrollWeek(me.organization_id, week);
  return { ok: true, message: "Ready.", data: payrollFile(view, format) };
}

/**
 * Emails the week's file to whoever runs payroll. Claimed first in
 * payroll_exports (unique per week, format and address), so pressing Send
 * twice sends one email; a failed send can be retried.
 */
export async function sendPayrollAction(weekStart: string): Promise<FinanceResult> {
  const me = await owner();
  if (!me) return NOT_OWNER;
  const week = weekOf(weekStart);
  if (!week) return { ok: false, error: "Pick a week." };
  const view = await loadPayrollWeek(me.organization_id, week);
  const to = view.setup.sendTo;
  if (!to) return { ok: false, error: "No send-to address — add it on the Payroll card in Settings › Integrations." };
  if (!view.lines.length) return { ok: false, error: "Nobody has hours or commission that week." };
  const file = payrollFile(view);
  const db = financeDb();

  const { data: existing } = await db
    .from("payroll_exports")
    .select("id, status")
    .eq("organization_id", me.organization_id)
    .eq("week_start", week)
    .eq("format", view.setup.format)
    .eq("sent_to", to)
    .maybeSingle();
  const prior = existing as { id: string; status: string } | null;
  if (prior?.status === "sent") return { ok: false, error: `Already sent to ${to}.` };
  if (prior?.status === "claimed") return { ok: false, error: "Already sending — refresh in a minute." };
  const row = {
    organization_id: me.organization_id,
    week_start: week,
    format: view.setup.format,
    sent_to: to,
    people: view.lines.length,
    total_hours: view.totals.hours,
    total_commission: view.totals.commission,
    status: "claimed",
    error: null,
    created_by: me.id,
  };
  const claim = prior ? await db.from("payroll_exports").update(row).eq("id", prior.id).eq("status", "failed") : await db.from("payroll_exports").insert(row);
  if (claim.error) return { ok: false, error: "Already sending, or migration 0363 isn't applied." };

  const text = [
    `Payroll for the week of ${view.weekStart} to ${view.weekEnd} (${view.setup.format === "adp" ? "ADP paydata" : "Gusto hours import"} attached).`,
    "",
    ...view.lines.map((l) => `${l.firstName} ${l.lastName}: ${l.regularHours} regular, ${l.overtimeHours} overtime${l.commission ? `, $${l.commission.toFixed(2)} commission` : ""}`),
    "",
    `Total: ${view.totals.hours} hours, $${view.totals.commission.toFixed(2)} commission.`,
  ].join("\n");
  const sent = await sendEmail({
    organizationId: me.organization_id,
    to,
    subject: `Payroll: week of ${view.weekStart}`,
    html: `<pre style="font-family:ui-monospace,monospace;font-size:13px">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`,
    text,
    stream: "transactional",
    attachments: [{ filename: file.filename, content: Buffer.from(file.csv, "utf8").toString("base64") }],
  });
  await db
    .from("payroll_exports")
    .update(sent.ok ? { status: "sent", sent_at: new Date().toISOString() } : { status: "failed", error: sent.message.slice(0, 500) })
    .eq("organization_id", me.organization_id)
    .eq("week_start", week)
    .eq("format", view.setup.format)
    .eq("sent_to", to);
  done();
  return sent.ok ? { ok: true, message: `Sent to ${to}.` } : { ok: false, error: sent.message };
}
