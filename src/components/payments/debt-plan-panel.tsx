"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Eye, Info, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { updateCardTerms } from "@/lib/actions/card-terms-actions";
import { money, type Card, type DebtPlan } from "@/lib/debt-plan";

/**
 * What is owed, what is coming, and what to pay.
 *
 * Three numbers that lived on three screens and never met: card debt, wages
 * owed, and money clients have not sent. Deciding what to pay each month meant
 * holding all of it in your head, which is how a card ends up over its limit
 * while there is money in a current account.
 *
 * Two plans, not one. What today's money covers is the only one safe to act
 * on; what the same rules would do once the outstanding invoices land is the
 * one to work towards. Showing them together, apart, is the whole point.
 */
export function DebtPlanPanel({
  plan,
  cards,
  cash,
  balancesAt,
  missing,
  canEdit,
}: {
  plan: DebtPlan;
  cards: Card[];
  cash: { inBank: number; stripeIncoming: number; receivable: number; owedToCrew: number };
  balancesAt: string | null;
  missing: string[];
  canEdit: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {plan.warnings.length > 0 && (
        <ul className="flex flex-col gap-2">
          {plan.warnings.map((warning) => (
            <li
              key={warning.message}
              className={cn(
                "flex gap-2 rounded-lg border px-3 py-2 text-sm",
                warning.level === "urgent"
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-400"
              )}
            >
              {warning.level === "urgent" ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <Eye className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-4">
        <Figure label="Owed on cards" value={money(plan.debt)} tone="bad" />
        <Figure label="In the bank now" value={money(cash.inBank)} />
        <Figure label="Stripe holding" value={money(cash.stripeIncoming)} hint="On its way, not landed" />
        <Figure label="Clients still owe" value={money(cash.receivable)} hint="Sold work, unpaid" />
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Figure label="Owed to the crew" value={money(cash.owedToCrew)} hint="Paid before any card" />
        <Figure label="Card minimums" value={money(plan.minimums)} hint="Due this month" />
        <Figure label="Free to pay today" value={money(plan.payableToday)} tone="good" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Plan
          title="Pay this today"
          blurb="Out of money that has actually arrived, after wages and the reserve."
          lines={plan.today}
          empty="Nothing is free to pay after wages and the reserve."
        />
        <Plan
          title="Once the outstanding money lands"
          blurb={`If Stripe settles and clients pay, ${money(plan.payableWhenPaid)} would be free. This is the plan to work towards, not to act on.`}
          lines={plan.whenPaid}
          empty="Even with everything collected, nothing would be free after wages."
          muted
        />
      </div>

      <CardTerms cards={cards} canEdit={canEdit} />

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {balancesAt && <p>Balances read {new Date(balancesAt).toLocaleString()}.</p>}
        <p>
          Minimums are covered in due-date order, then whatever is left goes against the dearest debt.
          Nothing that has not arrived is treated as spendable.
        </p>
        {missing.map((line) => (
          <p key={line} className="text-amber-700 dark:text-amber-500">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-lg border border-border bg-card/60 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone === "bad" && "text-destructive",
          tone === "good" && "text-primary"
        )}
      >
        {value}
      </p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Plan({
  title,
  blurb,
  lines,
  empty,
  muted,
}: {
  title: string;
  blurb: string;
  lines: DebtPlan["today"];
  empty: string;
  muted?: boolean;
}) {
  return (
    <section className={cn("rounded-lg border border-border p-3", muted && "bg-muted/30")}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{blurb}</p>
      {lines.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {lines.map((line) => (
            <li key={line.cardId} className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{line.name}</p>
                <p className="text-[11px] text-muted-foreground">{line.why}</p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{money(line.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The bits of a card the bank feed does not carry.
 *
 * Balances arrive by themselves. The rate, the minimum and the due date come
 * off a statement, and without them a card can be shown but not planned for.
 */
function CardTerms({ cards, canEdit }: { cards: Card[]; canEdit: boolean }) {
  if (cards.length === 0) return null;

  return (
    <section className="rounded-lg border border-border p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        Card terms
        <span className="text-xs font-normal text-muted-foreground">from the statement</span>
      </h3>
      <div className="mt-2 flex flex-col gap-3">
        {cards.map((card) => (
          <CardRow key={card.id} card={card} canEdit={canEdit} />
        ))}
      </div>
      {!canEdit && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5" /> Only whoever handles the money can change these.
        </p>
      )}
    </section>
  );
}

function CardRow({ card, canEdit }: { card: Card; canEdit: boolean }) {
  const [apr, setApr] = useState(card.apr == null ? "" : String(card.apr));
  const [minimum, setMinimum] = useState(card.minimumPayment == null ? "" : String(card.minimumPayment));
  const [limit, setLimit] = useState(card.creditLimit == null ? "" : String(card.creditLimit));
  const [dueDay, setDueDay] = useState(card.dueDay == null ? "" : String(card.dueDay));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateCardTerms({
        accountId: card.id,
        apr: apr.trim() === "" ? null : Number(apr),
        minimumPayment: minimum.trim() === "" ? null : Number(minimum),
        creditLimit: limit.trim() === "" ? null : Number(limit),
        dueDay: dueDay.trim() === "" ? null : Number(dueDay),
      });
      if (result.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      } else setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          {card.name}
          {card.mask && <span className="ml-1.5 text-xs text-muted-foreground">···{card.mask}</span>}
        </p>
        <span className="text-sm font-semibold tabular-nums text-destructive">{money(card.balance)}</span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Rate %" value={apr} onChange={setApr} disabled={!canEdit || pending} width="w-20" />
        <Field label="Minimum" value={minimum} onChange={setMinimum} disabled={!canEdit || pending} width="w-24" />
        <Field label="Limit" value={limit} onChange={setLimit} disabled={!canEdit || pending} width="w-28" />
        <Field label="Due day" value={dueDay} onChange={setDueDay} disabled={!canEdit || pending} width="w-20" />
        {canEdit && (
          <Button type="button" size="sm" variant="outline" className="h-8" disabled={pending} onClick={save}>
            {pending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            {saved ? "Saved" : "Save"}
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
  width,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  width: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn("h-8 text-xs", width)}
      />
    </label>
  );
}
