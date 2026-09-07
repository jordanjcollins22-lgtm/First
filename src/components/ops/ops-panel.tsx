"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowDownRight, ArrowUpRight, ChevronDown, ChevronUp, Loader2, Minus, Play, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { refreshPulse, runRamp, saveOpsTargets } from "@/lib/actions/ops-actions";
import type { OpsState } from "@/lib/data/ops";
import { BankLink } from "./bank-link";
import { LEVERS, MODE_LABEL, STATUS_LABEL, type Forecast, type LeverRank, type Signal, type SignalStatus, type Todo } from "@/lib/ops";

/**
 * The pulse, on the screen the office opens first.
 *
 * Four numbers against what the business wants, what to work on today with
 * the money first, what is coming and when, and the plan: how much the cash
 * allows, on which levers, cheapest job first. Left to itself the app makes
 * the plays each morning; with auto-ramp off it proposes and a person
 * presses Do it. The only typing is the targets and the cash on hand.
 */

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

const STATUS_CLASS: Record<SignalStatus, string> = {
  ok: "border-emerald-500/50 bg-emerald-50/70",
  watch: "border-amber-400/70 bg-amber-50/70",
  bad: "border-red-500/60 bg-red-50/70",
  unknown: "border-white/60 bg-card/60",
};
const STATUS_TEXT: Record<SignalStatus, string> = { ok: "text-emerald-700", watch: "text-amber-700", bad: "text-red-700", unknown: "text-muted-foreground" };
const DOT: Record<Todo["severity"], string> = { bad: "bg-red-500", watch: "bg-amber-400", info: "bg-slate-400" };

export function OpsPanel({ state, compact = false }: { state: OpsState; compact?: boolean }) {
  const { assessment: a, targets, pulse } = state;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showLevers, setShowLevers] = useState(false);
  const [showTargets, setShowTargets] = useState(!state.targetsSaved);
  const [form, setForm] = useState({
    evaluationsPerWeek: String(targets.evaluationsPerWeek),
    closeRate: String(Math.round(targets.closeRate * 100)),
    weeksBookedAhead: String(targets.weeksBookedAhead),
    cashOnHand: targets.cashOnHand == null ? "" : String(targets.cashOnHand),
    cashAsOf: targets.cashAsOf ?? new Date().toISOString().slice(0, 10),
    cashFloor: targets.cashFloor == null ? "" : String(targets.cashFloor),
    marketingShare: String(Math.round(targets.marketingShare * 100)),
    autoRamp: targets.autoRamp,
  });

  function run(work: () => Promise<{ ok: true; value: unknown } | { ok: false; error: string }>, done?: (value: unknown) => string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (done) setNotice(done(result.value));
      router.refresh();
    });
  }

  function save(over: Partial<typeof form> = {}) {
    const f = { ...form, ...over };
    const num = (v: string) => (v.trim() === "" ? null : Number(v));
    run(() =>
      saveOpsTargets({
        evaluationsPerWeek: Number(f.evaluationsPerWeek),
        closeRate: Number(f.closeRate) / 100,
        weeksBookedAhead: Number(f.weeksBookedAhead),
        cashOnHand: num(f.cashOnHand),
        cashAsOf: f.cashAsOf || null,
        cashFloor: num(f.cashFloor),
        marketingShare: Number(f.marketingShare) / 100,
        autoRamp: f.autoRamp,
        leverCosts: targets.leverCosts,
      })
    );
  }

  const modeClass = a.plan.mode === "all_out" ? "bg-red-600/15 text-red-700" : a.plan.mode === "ramp" ? "bg-amber-500/20 text-amber-800" : "bg-emerald-600/15 text-emerald-700";
  const computedAt = new Date(pulse.at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

  return (
    <div className="mb-6 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-base font-semibold">
          <Activity className="h-4 w-4" /> The pulse
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${modeClass}`}>{MODE_LABEL[a.plan.mode]}</span>
        </h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>as of {computedAt}</span>
          <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" disabled={isPending} onClick={() => run(refreshPulse)} title="Recompute the numbers now">
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Refresh
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {a.signals.map((s) => (
          <SignalTile key={s.key} signal={s} />
        ))}
      </div>

      <div className={`mt-4 grid gap-4 ${compact ? "" : "md:grid-cols-2"}`}>
        <section>
          <h3 className="text-sm font-semibold">Work on now</h3>
          {a.now.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">Nothing is waiting on you. The standing plays carry on; check back tomorrow.</p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {a.now.map((t) => (
                <TodoRow key={t.key} todo={t} />
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3 className="text-sm font-semibold">Coming up</h3>
          <ul className="mt-1.5 space-y-1.5">
            {a.ahead.map((f) => (
              <ForecastRow key={f.key} forecast={f} />
            ))}
          </ul>
        </section>
      </div>

      {!state.canSeeMoney ? null : (
      <section className="mt-4 border-t border-border pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">The plan</h3>
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={form.autoRamp}
              disabled={isPending}
              onChange={(e) => {
                setForm((f) => ({ ...f, autoRamp: e.target.checked }));
                save({ autoRamp: e.target.checked });
              }}
            />
            Ramp on its own each morning
          </label>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {a.plan.why} {money(a.plan.allowance)} a month is what the cash allows
          {a.cash == null ? " (a guess until the cash is entered)" : ` (${Math.round(targets.marketingShare * 100)}% of what is above the ${money(a.cashFloor)} floor)`}
          {a.plan.mode !== "steady" ? `; ${money(a.plan.budget)} this round.` : "."}
        </p>
        {a.plan.hold && <p className="mt-1 text-xs text-amber-700">{a.plan.hold}</p>}
        {a.plan.actions.length > 0 && (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-medium">Lever</th>
                  <th className="py-1 pr-2 font-medium">Put out</th>
                  <th className="py-1 pr-2 font-medium">Cost</th>
                  <th className="py-1 pr-2 font-medium">Evaluations</th>
                  <th className="py-1 pr-2 font-medium">Jobs</th>
                  <th className="py-1 font-medium">Why</th>
                </tr>
              </thead>
              <tbody>
                {a.plan.actions.map((x) => (
                  <tr key={x.lever} className="border-t border-border/60">
                    <td className="py-1 pr-2 font-medium">{x.label}</td>
                    <td className="py-1 pr-2 tabular-nums">
                      {x.units.toLocaleString()} {LEVERS[x.lever].units}
                    </td>
                    <td className="py-1 pr-2 tabular-nums">{money(x.cost)}</td>
                    <td className="py-1 pr-2 tabular-nums">{x.expectedEvaluations.toFixed(1)}</td>
                    <td className="py-1 pr-2 tabular-nums">{x.expectedJobs.toFixed(1)}</td>
                    <td className="py-1 text-muted-foreground">{x.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {a.plan.mode !== "steady" && !a.plan.hold && a.plan.actions.length > 0 && (
            <Button type="button" size="sm" disabled={isPending} onClick={() => run(runRamp, (v) => `${(v as { made: number }).made} plays made; they are on the marketing list waiting for approval.`)}>
              {isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
              {targets.autoRamp ? "Do it now rather than in the morning" : "Do it"}
            </Button>
          )}
          <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => setShowLevers((v) => !v)}>
            {showLevers ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} Every lever by cost per job
          </button>
          <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => setShowTargets((v) => !v)}>
            {showTargets ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} Targets and cash
          </button>
        </div>
        {state.actions.length > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Last round: {new Date(state.actions[0].at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}, {MODE_LABEL[state.actions[0].mode as keyof typeof MODE_LABEL] ?? state.actions[0].mode}, {money(Number(state.actions[0].budget))} budget, {state.actions[0].made} plays made
            {state.actions[0].by ? ` by ${state.actions[0].by}` : " by the app"}.
          </p>
        )}
        {notice && <p className="mt-2 text-xs text-emerald-700">{notice}</p>}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </section>
      )}

      {showLevers && state.canSeeMoney && (
        <section className="mt-3 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            What one job won costs from each lever, the business&apos;s own results weighed against a starting guess. The ramp spends on the cheapest first and skips any that does not pay for itself
            {a.closeRateObserved ? ` at the ${Math.round(a.closeRate * 100)}% closing rate` : ""}; a job is taken as {money(a.avgTicket)} with 40% margin.
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-medium">Lever</th>
                  <th className="py-1 pr-2 font-medium">A unit</th>
                  <th className="py-1 pr-2 font-medium">An evaluation</th>
                  <th className="py-1 pr-2 font-medium">A job</th>
                  <th className="py-1 pr-2 font-medium">Back per $1</th>
                  <th className="py-1 font-medium">From</th>
                </tr>
              </thead>
              <tbody>
                {a.levers.map((l) => (
                  <LeverRow key={l.key} lever={l} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {showTargets && state.canSeeMoney && (
        <section className="mt-3 border-t border-border pt-3">
          <BankLink bank={state.bank} configured={state.bankConfigured} />
          <p className="mt-3 text-xs text-muted-foreground">
            What the business wants
            {state.bank.linked ? ". The cash is read from the bank." : ", and the cash in the bank on a day. The app carries the cash forward with what has come in and gone out since, so it only needs entering when it is checked."}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Evaluations a week" value={form.evaluationsPerWeek} onChange={(v) => setForm((f) => ({ ...f, evaluationsPerWeek: v }))} />
            <Field label="Closing rate %" value={form.closeRate} onChange={(v) => setForm((f) => ({ ...f, closeRate: v }))} />
            <Field label="Weeks booked ahead" value={form.weeksBookedAhead} onChange={(v) => setForm((f) => ({ ...f, weeksBookedAhead: v }))} />
            <Field label="Marketing share %" value={form.marketingShare} onChange={(v) => setForm((f) => ({ ...f, marketingShare: v }))} hint="of the cash above the floor, a month" />
            {!state.bank.linked && <Field label="Cash on hand $" value={form.cashOnHand} onChange={(v) => setForm((f) => ({ ...f, cashOnHand: v }))} placeholder="in the bank" />}
            {!state.bank.linked && <Field label="As of" value={form.cashAsOf} onChange={(v) => setForm((f) => ({ ...f, cashAsOf: v }))} type="date" />}
            <Field label="Cash floor $" value={form.cashFloor} onChange={(v) => setForm((f) => ({ ...f, cashFloor: v }))} placeholder={`${Math.round(pulse.cash.overheadMonthly * 2)} (two months' overhead)`} />
          </div>
          <div className="mt-2">
            <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => save()}>
              {isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null} Save
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function SignalTile({ signal }: { signal: Signal }) {
  const Trend = signal.trend === "up" ? ArrowUpRight : signal.trend === "down" ? ArrowDownRight : Minus;
  return (
    <div className={`rounded-xl border p-3 ${STATUS_CLASS[signal.status]}`} title={signal.why}>
      <p className="text-xs text-muted-foreground">{signal.label}</p>
      <p className="flex items-center gap-1 text-xl font-bold tabular-nums">
        {signal.value}
        {signal.trend && <Trend className={`h-4 w-4 ${signal.trend === "up" ? "text-emerald-600" : signal.trend === "down" ? "text-red-600" : "text-muted-foreground"}`} />}
      </p>
      <p className={`text-[11px] ${STATUS_TEXT[signal.status]}`}>
        {STATUS_LABEL[signal.status]} · want {signal.target}
      </p>
    </div>
  );
}

function TodoRow({ todo }: { todo: Todo }) {
  const body = (
    <>
      <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${DOT[todo.severity]}`} />
      <span>
        <span className="font-medium">{todo.title}</span>
        <span className="block text-muted-foreground">{todo.detail}</span>
      </span>
    </>
  );
  return (
    <li className="text-xs">
      {todo.href ? (
        <Link href={todo.href} className="flex items-start gap-2 rounded-lg px-1 py-0.5 hover:bg-accent/50">
          {body}
        </Link>
      ) : (
        <span className="flex items-start gap-2 px-1 py-0.5">{body}</span>
      )}
    </li>
  );
}

function ForecastRow({ forecast }: { forecast: Forecast }) {
  return (
    <li className="flex items-start gap-2 px-1 py-0.5 text-xs">
      <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${forecast.severity === "bad" ? "bg-red-500" : forecast.severity === "watch" ? "bg-amber-400" : forecast.severity === "ok" ? "bg-emerald-500" : "bg-slate-400"}`} />
      <span>
        <span className="font-medium">{forecast.title}</span>
        <span className="block text-muted-foreground">{forecast.detail}</span>
      </span>
    </li>
  );
}

function LeverRow({ lever }: { lever: LeverRank }) {
  const from = lever.observedUnits > 0 ? `${lever.observedEvaluations} evaluations from ${lever.observedUnits.toLocaleString()} ${LEVERS[lever.key].units} (${lever.confidence})` : "the starting guess";
  return (
    <tr className="border-t border-border/60">
      <td className="py-1 pr-2 font-medium">{lever.label}</td>
      <td className="py-1 pr-2 tabular-nums">{lever.free ? "time" : `$${lever.unitCost.toFixed(2)}`}</td>
      <td className="py-1 pr-2 tabular-nums">{lever.costPerEvaluation == null ? "—" : money(lever.costPerEvaluation)}</td>
      <td className="py-1 pr-2 tabular-nums">{lever.costPerJob == null ? "—" : money(lever.costPerJob)}</td>
      <td className="py-1 pr-2 tabular-nums">{lever.returnPerDollar == null ? "—" : `$${lever.returnPerDollar.toFixed(1)}`}</td>
      <td className="py-1 text-muted-foreground">{from}</td>
    </tr>
  );
}

function Field({ label, value, onChange, hint, placeholder, type = "number" }: { label: string; value: string; onChange: (v: string) => void; hint?: string; placeholder?: string; type?: string }) {
  return (
    <label className="text-xs">
      <span className="block text-muted-foreground">{label}</span>
      <input type={type} step="any" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="mt-0.5 w-full rounded-md border border-input bg-background px-2 py-1 text-sm" />
      {hint && <span className="block text-[10px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
