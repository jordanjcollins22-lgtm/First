"use client";

import { useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { Loader2, Trash2, Undo2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  deleteTeamPayment,
  markPaymentPaid,
  markPaymentPending,
  recordTeamPayment,
} from "@/lib/actions/team-payment-actions";
import type {
  PayablePerson,
  TeamPaymentMethod,
  TeamPaymentStatus,
  TeamPaymentWithPayee,
} from "@/types/domain";

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Dates come back as plain `YYYY-MM-DD`. Splitting the parts by hand avoids
 * `new Date("2026-08-15")` parsing as UTC midnight and displaying as the day
 * before for anyone west of Greenwich. */
function formatDate(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  if (!year || !month || !day) return value;
  return `${Number(month)}/${Number(day)}/${year.slice(2)}`;
}

function formatPeriod(start: string | null, end: string | null): string {
  if (!start && !end) return "—";
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
  return formatDate(start ?? end);
}

const METHOD_LABELS: Record<TeamPaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  transfer: "Transfer",
  other: "Other",
};

function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-white/60 bg-card/60 px-4 py-3 backdrop-blur-md">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PaymentRow({ payment }: { payment: TeamPaymentWithPayee }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.message ?? "Something went wrong.");
    });
  }

  return (
    <tr className="border-b border-border align-middle">
      <td className="p-2 font-medium">
        {payment.payeeName}
        {error && <p className="text-xs font-normal text-destructive">{error}</p>}
      </td>
      <td className="p-2 tabular-nums">{formatCurrency(Number(payment.amount) || 0)}</td>
      <td className="p-2">
        {payment.status === "paid" ? (
          <Badge variant="secondary">Paid {formatDate(payment.paid_at)}</Badge>
        ) : (
          <Badge variant="outline">Owed</Badge>
        )}
      </td>
      <td className="p-2 text-muted-foreground">{payment.method ? METHOD_LABELS[payment.method] : "—"}</td>
      <td className="p-2 text-muted-foreground">{formatPeriod(payment.period_start, payment.period_end)}</td>
      <td className="p-2 tabular-nums text-muted-foreground">{payment.hours ?? "—"}</td>
      <td className="p-2 text-muted-foreground">{payment.note || "—"}</td>
      <td className="p-2">
        <div className="flex items-center justify-end gap-1">
          {payment.status === "pending" ? (
            <Button type="button" size="sm" disabled={isPending} onClick={() => run(() => markPaymentPaid(payment.id))}>
              Mark paid
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Move back to owed"
              disabled={isPending}
              onClick={() => run(() => markPaymentPending(payment.id))}
            >
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="Delete"
            disabled={isPending}
            onClick={() => run(() => deleteTeamPayment(payment.id))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

export function PaymentTracker({
  people,
  payments,
}: {
  people: PayablePerson[];
  payments: TeamPaymentWithPayee[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [profileId, setProfileId] = useState("");
  const [status, setStatus] = useState<TeamPaymentStatus>("paid");
  const [method, setMethod] = useState<TeamPaymentMethod>("transfer");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const totals = useMemo(() => {
    const monthPrefix = todayLocal().slice(0, 7);
    return payments.reduce(
      (acc, payment) => {
        const amount = Number(payment.amount) || 0;
        if (payment.status === "paid") {
          acc.paid += amount;
          if (payment.paid_at?.startsWith(monthPrefix)) acc.paidThisMonth += amount;
        } else {
          acc.pending += amount;
        }
        return acc;
      },
      { paid: 0, pending: 0, paidThisMonth: 0 }
    );
  }, [payments]);

  const perPerson = useMemo(() => {
    const byPerson = new Map<string, { name: string; paid: number; pending: number }>();
    for (const payment of payments) {
      const row = byPerson.get(payment.profile_id) ?? { name: payment.payeeName, paid: 0, pending: 0 };
      const amount = Number(payment.amount) || 0;
      if (payment.status === "paid") row.paid += amount;
      else row.pending += amount;
      byPerson.set(payment.profile_id, row);
    }
    // Whoever is owed the most comes first — that's the question this answers.
    return [...byPerson.entries()].sort(
      ([, a], [, b]) => b.pending - a.pending || a.name.localeCompare(b.name)
    );
  }, [payments]);

  const selectedPerson = people.find((p) => p.id === profileId) ?? null;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    // onSubmit rather than the form action prop: an action-bound form clears
    // its fields as submission starts, wiping a rejected entry.
    e.preventDefault();
    setError(null);
    setSaved(false);

    const formData = new FormData(e.currentTarget);
    const rawHours = String(formData.get("hours") ?? "").trim();
    const amount = Number(String(formData.get("amount") ?? "").trim());

    if (!profileId) {
      setError("Pick who this is for.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }

    startTransition(async () => {
      const result = await recordTeamPayment({
        profileId,
        amount,
        status,
        method,
        periodStart: String(formData.get("period_start") ?? "").trim() || null,
        periodEnd: String(formData.get("period_end") ?? "").trim() || null,
        hours: rawHours ? Number(rawHours) : null,
        paidAt: String(formData.get("paid_at") ?? "").trim() || null,
        note: String(formData.get("note") ?? "").trim() || null,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSaved(true);
      formRef.current?.reset();
      setProfileId("");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Currently owed" value={formatCurrency(totals.pending)} hint="Recorded but not yet paid" />
        <Tile label="Paid this month" value={formatCurrency(totals.paidThisMonth)} />
        <Tile label="Paid all time" value={formatCurrency(totals.paid)} />
      </div>

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 rounded-lg border border-border p-4"
      >
        <p className="text-sm font-semibold">Record a payment</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payment-person">Team member</Label>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger id="payment-person" className="h-11 w-52">
                <SelectValue placeholder="Choose someone" />
              </SelectTrigger>
              <SelectContent>
                {people.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payment-amount">Amount</Label>
            <Input
              id="payment-amount"
              name="amount"
              type="number"
              step="0.01"
              min={0}
              required
              placeholder="0.00"
              className="w-32"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payment-hours">Hours</Label>
            <Input id="payment-hours" name="hours" type="number" step="0.25" min={0} placeholder="—" className="w-24" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payment-status">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as TeamPaymentStatus)}>
              <SelectTrigger id="payment-status" className="h-11 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="pending">Owed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payment-method">Method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as TeamPaymentMethod)}>
              <SelectTrigger id="payment-method" className="h-11 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="check">Check</SelectItem>
                <SelectItem value="transfer">Transfer</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {status === "paid" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="payment-paid-at">Paid on</Label>
              <Input
                id="payment-paid-at"
                name="paid_at"
                type="date"
                defaultValue={todayLocal()}
                className="w-40"
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payment-period-start">Period from</Label>
            <Input id="payment-period-start" name="period_start" type="date" className="w-40" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payment-period-end">Period to</Label>
            <Input id="payment-period-end" name="period_end" type="date" className="w-40" />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="payment-note">Note</Label>
            <Input id="payment-note" name="note" placeholder="Optional — what this covers" className="min-w-48" />
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving...
              </>
            ) : (
              "Record payment"
            )}
          </Button>
        </div>

        {selectedPerson && (
          <p className="text-xs text-muted-foreground">
            {selectedPerson.name} is set up as {selectedPerson.payType}
            {selectedPerson.ratePerHour != null && ` at ${formatCurrency(selectedPerson.ratePerHour)}/hr`}
            {selectedPerson.commissionPct != null && ` with ${selectedPerson.commissionPct}% commission`}.
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        {saved && <p className="text-xs text-emerald-600">Payment recorded.</p>}
      </form>

      {perPerson.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">By person</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {perPerson.map(([id, row]) => (
              <div
                key={id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span className="font-medium">{row.name}</span>
                <span className="flex items-center gap-3 tabular-nums">
                  {row.pending > 0 && (
                    <span className="text-destructive">{formatCurrency(row.pending)} owed</span>
                  )}
                  <span className="text-muted-foreground">{formatCurrency(row.paid)} paid</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">Payment history</p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-2 font-medium">Team member</th>
                <th className="p-2 font-medium">Amount</th>
                <th className="p-2 font-medium">Status</th>
                <th className="p-2 font-medium">Method</th>
                <th className="p-2 font-medium">Period</th>
                <th className="p-2 font-medium">Hours</th>
                <th className="p-2 font-medium">Note</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <PaymentRow key={payment.id} payment={payment} />
              ))}
            </tbody>
          </table>
          {payments.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              No payments recorded yet. Add the first one above.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
