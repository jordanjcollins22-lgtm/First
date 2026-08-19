"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CommissionPanel } from "@/components/payments/commission-panel";
import type { ManagerCommission } from "@/lib/data/commission";
import { calculatePay, describePayStructure, hasCommissionComponent, hasHourlyComponent } from "@/lib/pay";
import {
  deleteTeamPayment,
  markTeamPaymentPaid,
  recordTeamPayment,
} from "@/lib/actions/payment-actions";
import { LedgerPanel } from "@/components/payments/ledger-panel";
import { OverheadList } from "@/components/overhead/overhead-list";
import type { PaymentsData } from "@/lib/data/payments";

const METHODS = ["cash", "check", "transfer", "other"] as const;
type Method = (typeof METHODS)[number];

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/60 bg-card/60 p-3 backdrop-blur-md">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Every direction money moves, on one screen.
 *
 * Overhead used to be its own page and is now a tab here: a recurring monthly
 * cost is money going out, and keeping it one click from the total it drags
 * down is the whole point of having a money screen at all.
 *
 * Summary leads, because the question somebody opens this page to answer is
 * almost always "where are we", not "what did I pay Jeff in March".
 */
export function PaymentsDashboard({
  data,
  canSeeOverhead,
  commission,
}: {
  data: PaymentsData;
  canSeeOverhead: boolean;
  /** Every account manager's book. Empty when nobody holds the role. */
  commission: ManagerCommission[];
}) {
  const { internal, external, ledger, ledgerTotals, overhead, revenue, team, jobOptions } = data;

  return (
    <Tabs defaultValue="summary">
      <TabsList>
        <TabsTrigger value="summary">Summary</TabsTrigger>
        <TabsTrigger value="ledger">In &amp; Out</TabsTrigger>
        <TabsTrigger value="internal">Team</TabsTrigger>
        {commission.length > 0 && <TabsTrigger value="commission">Commission</TabsTrigger>}
        <TabsTrigger value="external">Invoices</TabsTrigger>
        {canSeeOverhead && <TabsTrigger value="overhead">Overhead</TabsTrigger>}
      </TabsList>

      <TabsContent value="summary">
        <RevenuePanel revenue={revenue} />
      </TabsContent>

      <TabsContent value="ledger">
        <LedgerPanel entries={ledger} totals={ledgerTotals} jobOptions={jobOptions} />
      </TabsContent>

      <TabsContent value="internal">
        <InternalPayments payments={internal} team={team} />
      </TabsContent>

      {commission.length > 0 && (
        <TabsContent value="commission">
          <div className="flex flex-col gap-3">
            {commission.map((book) => (
              <CommissionPanel key={book.profileId} summary={book.summary} title={book.personName} />
            ))}
          </div>
        </TabsContent>
      )}

      <TabsContent value="external">
        <ExternalPayments payments={external} />
      </TabsContent>

      {canSeeOverhead && (
        <TabsContent value="overhead">
          <OverheadList expenses={overhead} />
        </TabsContent>
      )}
    </Tabs>
  );
}

/* ---------------------------------------------------------------- internal */

function InternalPayments({
  payments,
  team,
}: {
  payments: PaymentsData["internal"];
  team: PaymentsData["team"];
}) {
  const [profileId, setProfileId] = useState("");
  const [hours, setHours] = useState("");
  const [basis, setBasis] = useState("");
  const [amount, setAmount] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [method, setMethod] = useState<Method | "">("");
  const [note, setNote] = useState("");
  const [markPaid, setMarkPaid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const person = team.find((p) => p.id === profileId) ?? null;

  // What their pay structure says they're owed. It fills the amount box, and
  // the admin can overwrite it — the entered number is what gets recorded.
  const breakdown = useMemo(() => {
    if (!person) return null;
    return calculatePay(person, {
      hours: hours ? Number(hours) : null,
      commissionBasis: basis ? Number(basis) : null,
    });
  }, [person, hours, basis]);

  const suggested = breakdown?.total ?? 0;
  const effectiveAmount = amount !== "" ? Number(amount) : suggested;

  const pending = payments.filter((p) => p.status === "pending");
  const paid = payments.filter((p) => p.status === "paid");

  function reset() {
    setProfileId("");
    setHours("");
    setBasis("");
    setAmount("");
    setPeriodStart("");
    setPeriodEnd("");
    setMethod("");
    setNote("");
    setMarkPaid(false);
  }

  function submit(e: React.FormEvent) {
    // Plain onSubmit, not a form action — an action resets the fields the
    // instant it's submitted, wiping what they typed before validation runs.
    e.preventDefault();
    setError(null);

    if (!profileId) return setError("Pick who this is for.");
    if (!Number.isFinite(effectiveAmount) || effectiveAmount <= 0) {
      return setError("Enter an amount greater than zero.");
    }

    startTransition(async () => {
      const result = await recordTeamPayment({
        profileId,
        amount: effectiveAmount,
        hours: hours ? Number(hours) : null,
        periodStart: periodStart || null,
        periodEnd: periodEnd || null,
        method: method || null,
        note: note || null,
        markPaid,
      });
      if (!result.ok) setError(result.message);
      else reset();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
        <h2 className="mb-3 text-sm font-semibold">Record a payment</h2>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium">
            Team member
            <select
              value={profileId}
              onChange={(e) => {
                setProfileId(e.target.value);
                setAmount("");
              }}
              className="h-11 rounded-lg border border-border bg-background px-3 py-2 text-base"
            >
              <option value="">Choose someone…</option>
              {team.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email}
                </option>
              ))}
            </select>
          </label>

          {person && (
            <p className="rounded-lg bg-background/60 px-3 py-2 text-xs text-muted-foreground">
              Paid {describePayStructure(person)}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {person && hasHourlyComponent(person.pay_type) && (
              <label className="flex flex-col gap-1 text-xs font-medium">
                Hours worked
                <Input
                  type="number"
                  step="0.25"
                  min="0"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  placeholder="0"
                />
              </label>
            )}

            {person && hasCommissionComponent(person.pay_type) && (
              <label className="flex flex-col gap-1 text-xs font-medium">
                Sales this covers
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={basis}
                  onChange={(e) => setBasis(e.target.value)}
                  placeholder="0.00"
                />
              </label>
            )}
          </div>

          {breakdown && breakdown.lines.length > 0 && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
              {breakdown.lines.map((line) => (
                <p key={line} className="text-xs tabular-nums text-muted-foreground">
                  {line}
                </p>
              ))}
              <p className="mt-0.5 text-sm font-semibold tabular-nums">Suggested: {money(breakdown.total)}</p>
            </div>
          )}

          {breakdown?.warning && (
            <p className="rounded-lg border border-amber-400/70 bg-amber-50/60 px-3 py-2 text-xs">{breakdown.warning}</p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium">
              Amount to pay
              <Input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={suggested > 0 ? suggested.toFixed(2) : "0.00"}
              />
              {suggested > 0 && amount === "" && (
                <span className="text-[11px] text-muted-foreground">Leave blank to use the suggested amount.</span>
              )}
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium">
              Method
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as Method | "")}
                className="h-11 rounded-lg border border-border bg-background px-3 py-2 text-base"
              >
                <option value="">Not set</option>
                {METHODS.map((m) => (
                  <option key={m} value={m} className="capitalize">
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium">
              Period start
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              Period end
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs font-medium">
            Note
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={markPaid}
              onChange={(e) => setMarkPaid(e.target.checked)}
              className="h-3.5 w-3.5 cursor-pointer accent-primary"
            />
            Already paid — record it as settled rather than owed
          </label>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button type="submit" disabled={isPending} className="self-start">
            {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Record payment
          </Button>
        </div>
      </form>

      <PaymentList title="Owed" payments={pending} emptyText="Nobody's waiting on a payment." showActions />
      <PaymentList title="Paid" payments={paid} emptyText="No payments recorded yet." />
    </div>
  );
}

function PaymentList({
  title,
  payments,
  emptyText,
  showActions = false,
}: {
  title: string;
  payments: PaymentsData["internal"];
  emptyText: string;
  showActions?: boolean;
}) {
  const total = payments.reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {payments.length > 0 && <p className="text-sm font-semibold tabular-nums">{money(total)}</p>}
      </div>

      {payments.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {payments.map((payment) => (
            <PaymentRow key={payment.id} payment={payment} showActions={showActions} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PaymentRow({
  payment,
  showActions,
}: {
  payment: PaymentsData["internal"][number];
  showActions: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const period =
    payment.period_start && payment.period_end
      ? `${payment.period_start} → ${payment.period_end}`
      : payment.period_start || payment.period_end || null;

  return (
    <li className="rounded-lg border border-border p-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-sm font-medium">{payment.personName}</p>
        <p className="text-sm font-semibold tabular-nums">{money(Number(payment.amount))}</p>
      </div>
      <p className="text-xs text-muted-foreground">
        {[
          period,
          payment.hours != null ? `${payment.hours} hr` : null,
          payment.method,
          payment.paid_at ? `paid ${payment.paid_at}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "No period recorded"}
      </p>
      {payment.note && <p className="mt-0.5 text-xs">{payment.note}</p>}

      {showActions && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {METHODS.map((m) => (
            <button
              key={m}
              type="button"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await markTeamPaymentPaid(payment.id, m);
                  if (!result.ok) setError(result.message);
                })
              }
              className="min-h-9 rounded-md border border-border px-3 py-1.5 text-xs font-medium capitalize hover:bg-accent"
            >
              Paid by {m}
            </button>
          ))}
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteTeamPayment(payment.id);
                if (!result.ok) setError(result.message);
              })
            }
            className="ml-auto rounded-md p-2 text-muted-foreground hover:text-destructive"
            aria-label="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </li>
  );
}

/* ---------------------------------------------------------------- external */

function ExternalPayments({ payments }: { payments: PaymentsData["external"] }) {
  const open = payments.filter((p) => p.status === "open");
  const paid = payments.filter((p) => p.status === "paid");
  const other = payments.filter((p) => p.status !== "open" && p.status !== "paid");

  if (payments.length === 0) {
    return (
      <p className="rounded-xl border border-white/60 bg-card/60 p-4 text-sm text-muted-foreground backdrop-blur-md">
        No client invoices yet. One is created automatically when a client accepts a proposal.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <InvoiceList title="Awaiting payment" invoices={open} />
      <InvoiceList title="Paid" invoices={paid} />
      {other.length > 0 && <InvoiceList title="Void or written off" invoices={other} />}
    </div>
  );
}

function InvoiceList({ title, invoices }: { title: string; invoices: PaymentsData["external"] }) {
  if (invoices.length === 0) return null;
  const total = invoices.reduce((sum, i) => sum + i.amount, 0);

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-sm font-semibold tabular-nums">{money(total)}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {invoices.map((invoice) => (
          <li key={invoice.id} className="rounded-lg border border-border p-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <Link href={`/jobs/${invoice.jobId}`} className="text-sm font-medium hover:underline">
                {invoice.customerName}
              </Link>
              <p className="text-sm font-semibold tabular-nums">{money(invoice.amount)}</p>
            </div>
            <p className="text-xs text-muted-foreground">{invoice.address}</p>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span>{invoice.paidAt ? `Paid ${invoice.paidAt.slice(0, 10)}` : invoice.sentAt ? `Sent ${invoice.sentAt.slice(0, 10)}` : "Not sent"}</span>
              {invoice.hostedInvoiceUrl && (
                <a
                  href={invoice.hostedInvoiceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  Open in Stripe <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ----------------------------------------------------------------- revenue */

function RevenuePanel({ revenue }: { revenue: PaymentsData["revenue"] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <StatTile label="Collected" value={money(revenue.collected)} hint="Invoices actually paid" />
        <StatTile label="Cash & checks" value={money(revenue.ledgerIn)} hint="Taken outside Stripe" />
        <StatTile label="Outstanding" value={money(revenue.outstanding)} hint="Invoiced, not yet paid" />
        <StatTile label="Owed to team" value={money(revenue.owedToTeam)} hint="Recorded, not yet paid" />
      </div>

      <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
        <h2 className="mb-2 text-sm font-semibold">What&apos;s actually left</h2>
        <dl className="flex flex-col gap-1 text-sm">
          <Line label="Collected from clients" value={revenue.collected} />
          <Line label="Cash and checks in" value={revenue.ledgerIn} />
          <Line label="Paid to team" value={-revenue.paidOut} />
          <Line label="Materials, subs and the rest" value={-revenue.ledgerOut} />
          <Line label="Overhead" value={-revenue.overhead} />
          <div className="mt-1 flex items-baseline justify-between border-t border-border pt-1 font-semibold">
            <dt>Net</dt>
            <dd className={`tabular-nums ${revenue.net < 0 ? "text-destructive" : ""}`}>{money(revenue.net)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Cash in and out, not accrual profit — outstanding invoices and unpaid team payments are listed above but
          deliberately left out of this total until the money actually moves.
        </p>
      </section>
    </div>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{money(value)}</dd>
    </div>
  );
}
