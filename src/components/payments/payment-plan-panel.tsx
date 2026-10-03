"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Loader2, Plus, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  acceptPlan,
  createPlan,
  recordManualPayment,
  startPlanPayment,
} from "@/lib/actions/payment-plan-actions";
import {
  INTERVALS,
  buildSchedule,
  describePlan,
  outstandingCents,
  toCents,
  type Interval,
  type PlanKind,
} from "@/lib/payment-plan";
import type { Plan } from "@/lib/data/payment-plans";

function money(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function shortDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * How this job gets paid for.
 *
 * One plan at a time in practice, but the list is kept because a plan that
 * was offered and turned down is part of the story of the job, and deleting
 * it loses the answer to "what did we quote them".
 */
export function PaymentPlanPanel({
  jobId,
  customerId,
  plans,
  suggestedTotal,
  stripeReady,
}: {
  jobId: string;
  customerId: string | null;
  plans: Plan[];
  /** The accepted proposal, so the total is filled in rather than retyped. */
  suggestedTotal: number | null;
  stripeReady: boolean;
}) {
  const router = useRouter();
  const [offering, setOffering] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(work: () => Promise<{ ok: boolean; message?: string; url?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await work();
      setFailed(!result.ok);
      setMessage(result.message ?? null);
      if (result.url) window.location.href = result.url;
      else if (result.ok) {
        setOffering(false);
        router.refresh();
      }
    });
  }

  if (!customerId) return null;

  return (
    <section className="mt-6 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Wallet className="h-4 w-4" />
          Payment
        </h2>
        {!offering && (
          <Button type="button" size="sm" variant="outline" onClick={() => setOffering(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Offer a plan
          </Button>
        )}
      </div>

      {!stripeReady && (
        <p className="mb-3 rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-800">
          Stripe isn&apos;t connected, so card payments won&apos;t start. Plans and cash payments
          still work.
        </p>
      )}

      {plans.length === 0 && !offering && (
        <p className="text-sm text-muted-foreground">
          No plan on this job yet. Offer one to take a deposit, split it up, or set up something
          recurring.
        </p>
      )}

      {plans.map((plan) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          jobId={jobId}
          customerId={customerId}
          stripeReady={stripeReady}
          pending={pending}
          onRun={run}
        />
      ))}

      {offering && (
        <OfferPlan
          suggestedTotal={suggestedTotal}
          pending={pending}
          onCancel={() => setOffering(false)}
          onOffer={(input) => run(() => createPlan({ jobId, customerId, ...input }))}
        />
      )}

      {message && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            failed ? "bg-amber-500/15 text-amber-800" : "bg-emerald-500/15 text-emerald-700"
          }`}
        >
          {message}
        </p>
      )}
    </section>
  );
}

function PlanCard({
  plan,
  jobId,
  customerId,
  stripeReady,
  pending,
  onRun,
}: {
  plan: Plan;
  jobId: string;
  customerId: string;
  stripeReady: boolean;
  pending: boolean;
  onRun: (work: () => Promise<{ ok: boolean; message?: string; url?: string }>) => void;
}) {
  const outstanding = outstandingCents(plan.totalCents, [{ amountCents: plan.paidCents }]);

  return (
    <div className="mb-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          {describePlan({
            totalCents: plan.totalCents,
            kind: plan.kind,
            depositCents: plan.depositCents,
            instalments: plan.instalments ?? undefined,
            interval: plan.interval ?? undefined,
          })}
        </p>
        <span className="text-[11px] font-semibold uppercase text-muted-foreground">
          {plan.status}
        </span>
      </div>

      <p className="mt-0.5 text-xs text-muted-foreground">
        {money(plan.paidCents)} paid ·{" "}
        {outstanding === 0 ? "settled" : `${money(outstanding)} outstanding`}
      </p>

      {plan.schedule.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {plan.schedule.map((item) => (
            <li key={item.id} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate">
                {item.isDeposit ? "Deposit" : `Payment ${item.number}`}
                <span className="text-muted-foreground"> · due {shortDate(item.dueOn)}</span>
              </span>
              <span className="shrink-0 tabular-nums">{money(item.amountCents)}</span>
              <span
                className={`shrink-0 text-[11px] ${
                  item.status === "paid" ? "text-emerald-700" : "text-muted-foreground"
                }`}
              >
                {item.status === "paid" ? "paid" : "due"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {plan.status === "offered" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={pending}
            onClick={() => onRun(() => acceptPlan(plan.id, jobId))}
          >
            Customer accepted
          </Button>
        )}
        {outstanding > 0 && stripeReady && (
          <Button
            type="button"
            size="sm"
            className="h-7 text-xs"
            disabled={pending}
            onClick={() => onRun(() => startPlanPayment(plan.id, window.location.href))}
          >
            {pending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <CreditCard className="mr-1 h-3.5 w-3.5" />
            )}
            Take payment
          </Button>
        )}
        {outstanding > 0 && (
          <CashPayment
            jobId={jobId}
            customerId={customerId}
            planId={plan.id}
            outstandingCents={outstanding}
            pending={pending}
            onRun={onRun}
          />
        )}
      </div>
    </div>
  );
}

/** Cash and cheques are real payments and belong in the same ledger. */
function CashPayment({
  jobId,
  customerId,
  planId,
  outstandingCents: owed,
  pending,
  onRun,
}: {
  jobId: string;
  customerId: string;
  planId: string;
  outstandingCents: number;
  pending: boolean;
  onRun: (work: () => Promise<{ ok: boolean; message?: string }>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(owed / 100));
  const [method, setMethod] = useState<"cash" | "check" | "other">("cash");

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 text-xs"
        onClick={() => setOpen(true)}
      >
        Log cash or cheque
      </Button>
    );
  }

  return (
    <div className="mt-1 flex w-full flex-wrap items-center gap-1.5">
      <Input
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        inputMode="decimal"
        className="h-8 w-28 text-xs"
        aria-label="Amount"
      />
      <select
        value={method}
        onChange={(event) => setMethod(event.target.value as typeof method)}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        aria-label="How they paid"
      >
        <option value="cash">Cash</option>
        <option value="check">Cheque</option>
        <option value="other">Other</option>
      </select>
      <Button
        type="button"
        size="sm"
        className="h-8 text-xs"
        disabled={pending || !(Number(amount) > 0)}
        onClick={() =>
          onRun(async () => {
            const result = await recordManualPayment({
              jobId,
              customerId,
              planId,
              amountCents: toCents(Number(amount)),
              method,
            });
            if (result.ok) setOpen(false);
            return result;
          })
        }
      >
        Record
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}

function OfferPlan({
  suggestedTotal,
  pending,
  onOffer,
  onCancel,
}: {
  suggestedTotal: number | null;
  pending: boolean;
  onOffer: (input: {
    kind: PlanKind;
    totalCents: number;
    depositCents?: number;
    instalments?: number;
    interval?: Interval;
  }) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<PlanKind>("one_time");
  const [total, setTotal] = useState(suggestedTotal != null ? String(suggestedTotal) : "");
  const [deposit, setDeposit] = useState("");
  const [count, setCount] = useState("3");
  const [interval, setInterval] = useState<Interval>("monthly");

  const input = {
    kind,
    totalCents: toCents(Number(total) || 0),
    depositCents: toCents(Number(deposit) || 0),
    instalments: Number(count) || 0,
    interval,
  };
  // The customer's own words for it, before anybody is asked to agree.
  const preview = describePlan(input);
  const schedule = buildSchedule(input);

  return (
    <div className="rounded-lg border border-border bg-background/60 p-3">
      <div className="mb-2 grid grid-cols-3 gap-1">
        {(["one_time", "instalments", "subscription"] as PlanKind[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setKind(option)}
            className={`rounded-md border px-2 py-1.5 text-xs font-medium ${
              kind === option ? "border-primary bg-primary/10 text-primary" : "border-border"
            }`}
          >
            {option === "one_time" ? "One-off" : option === "instalments" ? "Plan" : "Recurring"}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <Input
          value={total}
          onChange={(event) => setTotal(event.target.value)}
          inputMode="decimal"
          placeholder={kind === "subscription" ? "Amount each time" : "Total"}
          className="h-9 text-sm"
          aria-label="Total"
        />

        {kind !== "subscription" && (
          <Input
            value={deposit}
            onChange={(event) => setDeposit(event.target.value)}
            inputMode="decimal"
            placeholder="Deposit today (optional)"
            className="h-9 text-sm"
            aria-label="Deposit"
          />
        )}

        {kind !== "one_time" && (
          <div className="flex gap-1.5">
            {kind === "instalments" && (
              <Input
                value={count}
                onChange={(event) => setCount(event.target.value)}
                inputMode="numeric"
                className="h-9 w-20 text-sm"
                aria-label="How many payments"
              />
            )}
            <select
              value={interval}
              onChange={(event) => setInterval(event.target.value as Interval)}
              className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="How often"
            >
              {INTERVALS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <p className="mt-2 rounded-md bg-secondary/60 px-2 py-1.5 text-xs">{preview}</p>

      <div className="mt-2 flex gap-1.5">
        <Button
          type="button"
          size="sm"
          className="flex-1"
          disabled={pending || schedule.length === 0}
          onClick={() =>
            onOffer({
              kind,
              totalCents: input.totalCents,
              depositCents: input.depositCents,
              instalments: kind === "instalments" ? input.instalments : undefined,
              interval: kind === "one_time" ? undefined : interval,
            })
          }
        >
          {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          Offer it
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
