"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CalendarClock, Check, Plus } from "lucide-react";

import { ChosenContact, ContactPicker } from "@/components/payments/contact-picker";
import { createPlan, recordManualPayment } from "@/lib/actions/payment-plan-actions";
import {
  buildSchedule,
  checkPlan,
  describePlan,
  INTERVALS,
  toCents,
  type Interval,
  type PlanKind,
} from "@/lib/payment-plan";
import {
  byPlanUrgency,
  planProgress,
  plansLine,
  summarisePlans,
} from "@/lib/plan-progress";
import type { Plan } from "@/lib/data/payment-plans";
import type { SearchableContact } from "@/lib/payer-match";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function day(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Who is paying us over time, and who is behind.
 *
 * The list is ordered by what needs a phone call rather than by when it was
 * agreed: behind first, then by what falls due soonest, with the paid-off and
 * cancelled at the bottom where nothing needs doing about them.
 */
export function SchedulesPanel({ plans }: { plans: Plan[] }) {
  const [filter, setFilter] = useState<"running" | "all">("running");

  const summary = useMemo(() => summarisePlans(plans), [plans]);
  const shown = useMemo(() => {
    const ordered = byPlanUrgency(plans);
    if (filter === "all") return ordered;
    return ordered.filter(
      (p) => p.status !== "cancelled" && !planProgress(p).settled
    );
  }, [plans, filter]);

  return (
    <div className="space-y-4">
      <NewSchedule />

      <div>
        <p className="mb-2 text-sm text-muted-foreground">{plansLine(summary)}</p>

        <div className="mb-2 flex gap-1.5">
          <FilterButton active={filter === "running"} onClick={() => setFilter("running")}>
            Still owed ({summary.running})
          </FilterButton>
          <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
            All ({summary.plans})
          </FilterButton>
        </div>

        {shown.length === 0 ? (
          <p className="rounded-lg border border-border bg-card/60 px-3 py-6 text-center text-sm text-muted-foreground">
            {plans.length === 0
              ? "No payment schedules yet. Set one up above when somebody agrees to pay over time."
              : "Nothing outstanding. Every schedule is paid off."}
          </p>
        ) : (
          <ul className="space-y-2">
            {shown.map((plan) => (
              <PlanCard key={plan.id} plan={plan} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
        active ? "bg-foreground text-background" : "border border-border bg-card/60"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Setting one up.
 *
 * The schedule is shown before it is saved, because a plan somebody agreed to
 * on the phone and a plan the software worked out are meant to be the same
 * list, and the only way to know is to look at it.
 */
function NewSchedule() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState<SearchableContact | null>(null);
  const [kind, setKind] = useState<PlanKind>("instalments");
  const [total, setTotal] = useState("");
  const [deposit, setDeposit] = useState("");
  const [count, setCount] = useState("3");
  const [interval, setInterval] = useState<Interval>("monthly");
  const [startOn, setStartOn] = useState(new Date().toISOString().slice(0, 10));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const input = {
    kind,
    totalCents: toCents(Number(total.replace(/[^0-9.]/g, "")) || 0),
    depositCents: toCents(Number(deposit.replace(/[^0-9.]/g, "")) || 0),
    instalments: Number(count) || 1,
    interval,
  };

  const verdict = checkPlan(input);
  const preview = verdict.ok ? buildSchedule(input) : [];

  async function save() {
    if (!contact || !verdict.ok) return;
    setBusy(true);
    setError(null);

    // Typed in by hand means the customer already said yes; it was never an
    // offer waiting on them.
    const result = await createPlan({
      ...input,
      jobId: null,
      customerId: contact.id,
      startOn,
      alreadyAgreed: true,
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDone(`Schedule set up for ${contact.name ?? "that contact"}.`);
    setTotal("");
    setDeposit("");
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-card/60 px-3 py-2.5 text-sm font-semibold"
      >
        <Plus className="h-4 w-4" /> Set up a payment schedule
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <CalendarClock className="h-4 w-4" /> New payment schedule
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline"
        >
          Close
        </button>
      </div>

      {contact ? (
        <div className="mb-2">
          <ChosenContact contact={contact} onClear={() => setContact(null)} />
        </div>
      ) : (
        <ContactPicker onPick={setContact} placeholder="Who is on this schedule?" />
      )}

      {contact && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { value: "instalments", label: "Instalments" },
                { value: "one_time", label: "One payment" },
                { value: "subscription", label: "Recurring" },
              ] as { value: PlanKind; label: string }[]
            ).map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => setKind(k.value)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                  kind === k.value
                    ? "bg-foreground text-background"
                    : "border border-border bg-background"
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field
              label={kind === "subscription" ? "Each payment" : "Total"}
              value={total}
              onChange={setTotal}
              placeholder="$3,000"
            />
            <Field label="Starts" value={startOn} onChange={setStartOn} type="date" />
            {kind === "instalments" && (
              <>
                <Field label="Deposit" value={deposit} onChange={setDeposit} placeholder="$0" />
                <Field label="How many" value={count} onChange={setCount} placeholder="3" />
              </>
            )}
          </div>

          {kind !== "one_time" && (
            <div className="flex flex-wrap gap-1.5">
              {INTERVALS.map((i) => (
                <button
                  key={i.value}
                  type="button"
                  onClick={() => setInterval(i.value)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    interval === i.value
                      ? "bg-foreground text-background"
                      : "border border-border bg-background"
                  }`}
                >
                  {i.label}
                </button>
              ))}
            </div>
          )}

          {/* Shown before it is saved. A schedule somebody agreed to on the
              phone and one the software worked out should be the same list,
              and looking at it is the only way to know. */}
          {verdict.ok ? (
            <div className="rounded-md border border-border bg-background p-2">
              <p className="mb-1 text-xs font-semibold">{describePlan(input)}</p>
              <ul className="space-y-0.5">
                {preview.slice(0, 8).map((item) => (
                  <li
                    key={item.number}
                    className="flex justify-between gap-2 text-[11px] text-muted-foreground"
                  >
                    <span>
                      {item.isDeposit ? "Deposit" : `Payment ${item.number}`} ·{" "}
                      {item.dueInDays === 0 ? "now" : `in ${item.dueInDays} days`}
                    </span>
                    <span className="tabular-nums">{money(item.amountCents)}</span>
                  </li>
                ))}
                {preview.length > 8 && (
                  <li className="text-[11px] text-muted-foreground">
                    and {preview.length - 8} more
                  </li>
                )}
              </ul>
            </div>
          ) : (
            total !== "" && (
              <p className="text-xs text-muted-foreground">{verdict.reason}</p>
            )
          )}

          <button
            type="button"
            disabled={busy || !verdict.ok}
            onClick={save}
            className="w-full rounded-md bg-foreground px-3 py-2 text-sm font-semibold text-background disabled:opacity-50"
          >
            {busy ? "Setting up…" : "Set up the schedule"}
          </button>
        </div>
      )}

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-destructive">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}
      {done && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5" /> {done}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        inputMode={type === "text" ? "decimal" : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
      />
    </label>
  );
}

/** One schedule: how far through it is, what is behind, and the one thing
 * anybody does to it — say an instalment came in. */
function PlanCard({ plan }: { plan: Plan }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [settledIds, setSettledIds] = useState<string[]>([]);

  const progress = planProgress(plan);
  const behind = progress.overdue.length > 0;

  function markPaid(instalmentId: string, amountCents: number) {
    setError(null);
    // Struck through immediately and put back if the write fails: the office
    // works down a list and should not wait on a round trip per row.
    setSettledIds((ids) => [...ids, instalmentId]);

    start(async () => {
      const result = await recordManualPayment({
        jobId: plan.jobId ?? null,
        customerId: plan.customerId ?? "",
        planId: plan.id,
        instalmentId,
        amountCents,
        method: "check",
        note: "Instalment",
      });

      if (!result.ok) {
        setSettledIds((ids) => ids.filter((id) => id !== instalmentId));
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="rounded-lg border border-border bg-card/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {plan.customerName ?? "Unnamed contact"}
          </p>
          <p className="text-xs text-muted-foreground">
            {money(plan.paidCents)} of {money(plan.totalCents)} in
            {progress.next ? ` · next ${day(progress.next.dueOn)}` : ""}
          </p>
        </div>
        <p className="shrink-0 text-base font-bold">{money(progress.outstandingCents)}</p>
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${behind ? "bg-destructive" : "bg-emerald-500"}`}
          style={{ width: `${Math.round(progress.fraction * 100)}%` }}
        />
      </div>

      {behind && (
        <p className="mt-2 text-xs font-semibold text-destructive">
          {progress.overdue.length} payment{progress.overdue.length === 1 ? "" : "s"} behind ·{" "}
          {money(progress.overdueCents)}
        </p>
      )}

      <ul className="mt-2 space-y-0.5 border-l-2 border-border pl-2">
        {plan.schedule.map((item) => {
          const paid = item.status === "paid" || settledIds.includes(item.id);
          return (
            <li key={item.id} className="flex items-center justify-between gap-2 text-xs">
              <span className={`truncate ${paid ? "text-muted-foreground line-through" : ""}`}>
                {item.isDeposit ? "Deposit" : `Payment ${item.number}`} · {day(item.dueOn)}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="tabular-nums text-muted-foreground">
                  {money(item.amountCents)}
                </span>
                {!paid && item.status !== "cancelled" && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => markPaid(item.id, item.amountCents)}
                    className="rounded border border-emerald-300/70 bg-emerald-50/70 px-1.5 py-0.5 text-[11px] font-semibold disabled:opacity-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
                  >
                    Paid
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {error && <p className="mt-2 text-xs font-medium text-destructive">{error}</p>}
    </li>
  );
}
