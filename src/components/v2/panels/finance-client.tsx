"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  autopayLinkAction,
  payrollFileAction,
  runQboSyncNowAction,
  saveFinanceSettingsAction,
  savePayrollIdsAction,
  sendAutopayLinkAction,
  sendPayrollAction,
  setAutopayAction,
  type FinanceSettingsInput,
} from "@/lib/actions/finance-actions";
import type { PayrollWeekView } from "@/lib/data/payroll";
import type { AutopayClient } from "@/lib/finance/autopay";
import { OpenEntity } from "@/components/v2/panels/admin-open";

type Result = { ok: true; message: string } | { ok: false; error: string };

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<Result>, after?: (r: Result) => void) =>
    start(async () => {
      const r = await fn();
      setMessage(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      after?.(r);
      router.refresh();
    });
  return { pending, message, run, setMessage };
}

function Note({ message }: { message: { ok: boolean; text: string } | null }) {
  if (!message) return null;
  return (
    <p role="status" className={`text-sm ${message.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
      {message.text}
    </p>
  );
}

function Toggle({ label, checked, onChange, disabled, help }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; help?: React.ReactNode }) {
  return (
    <label className="flex min-h-11 items-start gap-3 py-1">
      <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-medium">{label}</span>
        {help && <span className="block text-sm text-muted-foreground">{help}</span>}
      </span>
    </label>
  );
}

const since = (iso: string | null) => (iso ? ` On since ${new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.` : "");
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function FinanceSettingsForm(props: {
  settings: {
    offerAch: boolean;
    autopayEnabled: boolean;
    autopayStartedAt: string | null;
    lateFeeEnabled: boolean;
    lateFeeStartedAt: string | null;
    lateFeeKind: "percent" | "flat";
    lateFeeAmount: number;
    lateFeeGraceDays: number;
    dsoTargetDays: number;
    ready: boolean;
  };
  feeExample: { ach: number; card: number };
}) {
  const s = props.settings;
  const { pending, message, run } = useAction();
  const [kind, setKind] = useState(s.lateFeeKind);
  const [amount, setAmount] = useState(String(s.lateFeeAmount));
  const [grace, setGrace] = useState(String(s.lateFeeGraceDays));
  const [dsoTarget, setDsoTarget] = useState(String(s.dsoTargetDays));
  const save = (input: FinanceSettingsInput) => run(() => saveFinanceSettingsAction(input));

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      {!s.ready && <p className="text-sm text-amber-800 dark:text-amber-200">Settings can&apos;t be saved until migration 0363 is applied.</p>}
      <Toggle
        label="Offer bank payment (ACH) on invoices"
        checked={s.offerAch}
        disabled={pending}
        onChange={(v) => save({ offerAch: v })}
        help={<>Clients can pay by bank as well as card. On a $2,000 invoice that is {money(props.feeExample.ach)} by bank against {money(props.feeExample.card)} by card (0.8% capped at $5, vs 2.9% + 30¢). Stripe must have ACH Direct Debit switched on.</>}
      />
      <Toggle
        label="Autopay for recurring clients"
        checked={s.autopayEnabled}
        disabled={pending}
        onChange={(v) => save({ autopayEnabled: v })}
        help={<>Clients put on autopay below are charged automatically from their saved card or bank when an invoice is raised. Only invoices raised after this is switched on are ever charged.{since(s.autopayStartedAt)}</>}
      />
      <div className="space-y-2 border-t pt-3">
        <Toggle
          label="Late fees"
          checked={s.lateFeeEnabled}
          disabled={pending}
          onChange={(v) => {
            if (v && !window.confirm("Maryland limits interest and late fees on consumer contracts (commonly cited: 6% a year simple interest without a written agreement). Switch on only if your signed terms allow this fee. Switch on?")) return;
            save({ lateFeeEnabled: v });
          }}
          help={<>Off by default. Maryland limits apply: charge only what your signed contract allows, and check with your accountant or attorney first. The fee is shown on the receivables list; it is not added to invoices automatically. Only invoices raised after switching on are counted.{since(s.lateFeeStartedAt)}</>}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Fee is</span>
            <select className="min-h-11 rounded-md border bg-background px-3" value={kind} onChange={(e) => setKind(e.target.value as "percent" | "flat")}>
              <option value="percent">a percent of the balance</option>
              <option value="flat">a flat amount</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">{kind === "percent" ? "Percent" : "Dollars"}</span>
            <Input className="min-h-11" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Days late before it applies</span>
            <Input className="min-h-11" inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value)} />
          </label>
        </div>
      </div>
      <label className="grid max-w-xs gap-1 border-t pt-3 text-sm">
        <span className="font-medium">DSO target (days)</span>
        <Input className="min-h-11" inputMode="numeric" value={dsoTarget} onChange={(e) => setDsoTarget(e.target.value)} />
      </label>
      <Button
        className="min-h-11"
        disabled={pending}
        onClick={() => save({ lateFeeKind: kind, lateFeeAmount: Number(amount), lateFeeGraceDays: Number(grace), dsoTargetDays: Number(dsoTarget) })}
      >
        Save
      </Button>
      <Note message={message} />
    </div>
  );
}

export function AutopayList({ clients, autopayOn }: { clients: AutopayClient[]; autopayOn: boolean }) {
  const { pending, message, run } = useAction();
  const [links, setLinks] = useState<Record<string, string>>({});
  const onCount = clients.filter((c) => c.enabled && c.confirmedAt).length;
  const recurring = clients.filter((c) => c.recurring).length;

  return (
    <details className="rounded-xl border bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 p-4">
        <span className="font-semibold">Autopay clients</span>
        <span className="text-sm text-muted-foreground">
          {onCount} on autopay · {recurring} recurring{!autopayOn && " · autopay is off, nothing will be charged"}
        </span>
      </summary>
      <div className="space-y-2 border-t p-4">
        {clients.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recurring clients yet: a client shows here with a subscription plan or two invoices in six months.</p>
        ) : (
          <ul className="divide-y">
            {clients.map((c) => (
              <li key={c.customerId} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <OpenEntity kind="admin.customer" id={c.customerId} className="min-h-11 min-w-0 flex-1 font-medium">
                    {c.name}
                  </OpenEntity>
                  <span className="text-xs text-muted-foreground">
                    {c.confirmedAt ? `${c.methodType === "us_bank_account" ? "Bank" : "Card"} ••${c.last4 ?? ""}` : c.setupRequestedAt ? "Waiting for them to save a method" : "No method saved"}
                  </span>
                </div>
                {c.lastError && <p className="text-sm text-red-700 dark:text-red-300">Last charge failed: {c.lastError}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant={c.enabled ? "secondary" : "default"} className="min-h-11" disabled={pending} onClick={() => run(() => setAutopayAction(c.customerId, !c.enabled))}>
                    {c.enabled ? "Take off autopay" : "Put on autopay"}
                  </Button>
                  {!c.confirmedAt && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="min-h-11"
                        disabled={pending}
                        onClick={() =>
                          run(
                            async () => {
                              const r = await autopayLinkAction(c.customerId);
                              if (r.ok && r.data) setLinks((l) => ({ ...l, [c.customerId]: r.data!.url }));
                              return r;
                            }
                          )
                        }
                      >
                        Get setup link
                      </Button>
                      <Button size="sm" variant="secondary" className="min-h-11" disabled={pending || !c.email} onClick={() => run(() => sendAutopayLinkAction(c.customerId))}>
                        Email setup link
                      </Button>
                    </>
                  )}
                </div>
                {links[c.customerId] && (
                  <Input readOnly className="min-h-11 font-mono text-xs" value={links[c.customerId]} onFocus={(e) => e.currentTarget.select()} aria-label="Setup link" />
                )}
              </li>
            ))}
          </ul>
        )}
        <Note message={message} />
      </div>
    </details>
  );
}

export function QboSyncCard({
  status,
}: {
  status: {
    connected: boolean;
    enabled: boolean;
    startedAt: string | null;
    from: string | null;
    lastRun: { startedAt: string; finishedAt: string | null; summary: string | null; failed: number } | null;
    mapped: Record<string, number>;
    errors: { entity: string; localId: string; error: string; attempts: number }[];
  };
}) {
  const { pending, message, run } = useAction();
  const [from, setFrom] = useState(status.from ? status.from.slice(0, 10) : "");
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 font-semibold">QuickBooks sync</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.enabled && status.connected ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100" : "bg-muted text-muted-foreground"}`}>
          {!status.connected ? "Not connected" : status.enabled ? "On, hourly" : "Off"}
        </span>
      </div>
      {!status.connected && <p className="text-sm text-muted-foreground">Not connected — add it in Settings › Integrations (QuickBooks Online), then switch the sync on here.</p>}
      <Toggle
        label="Copy customers, invoices and payments to QuickBooks"
        checked={status.enabled}
        disabled={pending}
        onChange={(v) => run(() => saveFinanceSettingsAction({ qboSyncEnabled: v }))}
        help={<>One way, every hour. Only records from the start date on are sent; nothing already in QuickBooks is changed except what this sync created.{since(status.startedAt)}</>}
      />
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Send records from</span>
          <Input type="date" className="min-h-11" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <Button
          variant="secondary"
          className="min-h-11"
          disabled={pending}
          onClick={() => {
            if (from && status.startedAt && from < status.startedAt.slice(0, 10) && !window.confirm("That is before the sync was switched on, so older records will be copied into QuickBooks once. Make sure your bookkeeper hasn't typed them in already. Go ahead?")) return;
            run(() => saveFinanceSettingsAction({ qboSyncFrom: from || null }));
          }}
        >
          Save date
        </Button>
        <Button className="min-h-11" disabled={pending || !status.enabled || !status.connected} onClick={() => run(runQboSyncNowAction)}>
          Sync now
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        In QuickBooks: {status.mapped.customer ?? 0} customers, {status.mapped.invoice ?? 0} invoices, {status.mapped.payment ?? 0} payments.
        {status.lastRun && <> Last run {new Date(status.lastRun.startedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}: {status.lastRun.summary ?? "running…"}</>}
      </p>
      {status.errors.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-100">
          {status.errors.map((e) => (
            <li key={`${e.entity}:${e.localId}`}>
              {e.entity} {e.localId.slice(0, 8)}: {e.error}
              {e.attempts >= 5 && " (stopped retrying — fix it in QuickBooks or the app, then it resends when the record changes)"}
            </li>
          ))}
        </ul>
      )}
      <Note message={message} />
    </div>
  );
}

function download(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function PayrollCard({ initial, people }: { initial: PayrollWeekView | null; people: { id: string; name: string; payrollId: string }[] }) {
  const { pending, message, run } = useAction();
  const [ids, setIds] = useState<Record<string, string>>(() => Object.fromEntries(people.map((p) => [p.id, p.payrollId])));
  if (!initial) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        <h3 className="font-semibold text-foreground">Payroll</h3>
        Payroll couldn&apos;t load this week&apos;s hours.
      </div>
    );
  }
  const w = initial;
  const fileFor = (format: "gusto" | "adp") =>
    run(async () => {
      const r = await payrollFileAction(w.weekStart, format);
      if (r.ok && r.data) download(r.data.filename, r.data.csv);
      return r.ok ? { ok: true, message: "Downloaded." } : r;
    });
  const sent = w.sent.find((s) => s.status === "sent");

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 font-semibold">Payroll — week of {w.weekStart}</h3>
        <span className="text-xs text-muted-foreground">{w.setup.format === "adp" ? "ADP" : "Gusto"} format</span>
      </div>
      {!w.setup.connected && <p className="text-sm text-muted-foreground">Payroll isn&apos;t set up — add it in Settings › Integrations to pick Gusto or ADP and where the file goes. You can still download either file below.</p>}
      {w.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody clocked hours, recorded a crew day or has commission payable for this week.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2 font-medium">Person</th>
                <th className="p-2 font-medium">Regular</th>
                <th className="p-2 font-medium">Overtime</th>
                <th className="p-2 font-medium">Commission</th>
                <th className="p-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {w.lines.map((l) => (
                <tr key={l.profileId} className="border-t">
                  <td className="p-2">
                    {l.firstName} {l.lastName}
                  </td>
                  <td className="p-2 font-mono">{l.regularHours}</td>
                  <td className="p-2 font-mono">{l.overtimeHours || ""}</td>
                  <td className="p-2 font-mono">{l.commission ? `$${l.commission.toFixed(2)}` : ""}</td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {[l.fromEvents ? `${l.fromEvents} day${l.fromEvents === 1 ? "" : "s"} from crew events` : "", l.openEntries ? `${l.openEntries} clock-in left open (not counted)` : "", l.payrollId ? "" : "no payroll ID"].filter(Boolean).join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-sm">
            Total {w.totals.hours} hours ({w.totals.overtime} overtime), ${w.totals.commission.toFixed(2)} commission.
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="min-h-11" disabled={pending} onClick={() => fileFor("gusto")}>
          Download Gusto CSV
        </Button>
        <Button variant="secondary" className="min-h-11" disabled={pending} onClick={() => fileFor("adp")}>
          Download ADP CSV
        </Button>
        <Button className="min-h-11" disabled={pending || !w.setup.sendTo || !w.lines.length || Boolean(sent)} onClick={() => run(() => sendPayrollAction(w.weekStart))}>
          {sent ? `Sent to ${sent.sentTo}` : w.setup.sendTo ? `Send to ${w.setup.sendTo}` : "Send to payroll"}
        </Button>
      </div>
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">Payroll IDs (Gusto employee ID or ADP file #)</summary>
        <div className="grid gap-2 pt-2 sm:grid-cols-2">
          {people.map((p) => (
            <label key={p.id} className="grid gap-1">
              <span>{p.name}</span>
              <Input className="min-h-11" value={ids[p.id] ?? ""} onChange={(e) => setIds((v) => ({ ...v, [p.id]: e.target.value }))} />
            </label>
          ))}
        </div>
        <Button className="mt-2 min-h-11" variant="secondary" disabled={pending} onClick={() => run(() => savePayrollIdsAction(ids))}>
          Save IDs
        </Button>
      </details>
      <Note message={message} />
    </div>
  );
}
