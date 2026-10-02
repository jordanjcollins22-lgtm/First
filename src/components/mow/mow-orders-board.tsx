"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertTriangle, Check, Clock, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { markMowCalled } from "@/lib/actions/mow-order-actions";
import type { MowOrderRow } from "@/lib/data/mow-orders";
import { callClock } from "@/lib/mow-calls";
import { dollars, tierByKey } from "@/lib/mow-price";
import { shortWhen } from "@/lib/time-zone";

/** The call list for quick mows. Kept apart from the loading so it can be previewed with sample orders. */
export function MowOrdersBoard({ orders, now }: { orders: MowOrderRow[] | null; now?: Date }) {
  const toCall = (orders ?? []).filter((o) => o.status === "paid" && !o.calledAt).sort((a, b) => (a.paidAt ?? "").localeCompare(b.paidAt ?? ""));
  const called = (orders ?? []).filter((o) => o.status === "paid" && o.calledAt);
  const unpaid = (orders ?? []).filter((o) => o.status === "unpaid");
  const paidTotal = (orders ?? []).filter((o) => o.status === "paid").reduce((sum, o) => sum + o.amountCents, 0);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">Quick mows</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paid online from the quick mow page. Each one was promised a call within 24 hours to set their day.
        </p>
        {orders && (
          <p className="mt-2 text-sm">
            <span className="font-semibold">{(orders ?? []).filter((o) => o.status === "paid").length} paid</span>
            <span className="text-muted-foreground"> · {dollars(paidTotal)} taken · {unpaid.length} started but didn&apos;t pay</span>
          </p>
        )}
      </header>

      {orders === null && <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">Couldn&apos;t load quick mows just now. Reload the page.</p>}

      <section className="space-y-2">
        <h2 className="text-base font-semibold">To call</h2>
        {toCall.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Nobody waiting for a call.</p>
        ) : (
          <ul className="space-y-2">
            {toCall.map((o) => (
              <OrderCard key={o.id} order={o} now={now} />
            ))}
          </ul>
        )}
      </section>

      {unpaid.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Started but didn&apos;t pay</h2>
          <p className="text-xs text-muted-foreground">They got a price and opened the card form. Worth a call: they wanted a mow.</p>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {unpaid.map((o) => (
              <li key={o.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{o.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {o.address} · {tierByKey(o.tier)?.label ?? o.tier} · {shortWhen(o.createdAt)}
                  </p>
                </div>
                <a href={`tel:${o.phone}`} className="flex items-center gap-1 font-medium text-primary">
                  <Phone className="h-4 w-4" /> {o.phone}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {called.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Called</h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {called.map((o) => (
              <li key={o.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{o.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {o.address} · called {shortWhen(o.calledAt!)}
                  </p>
                </div>
                {o.jobId && (
                  <Link href={`/jobs/${o.jobId}`} className="text-xs font-medium text-primary hover:underline">
                    Job
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function OrderCard({ order, now }: { order: MowOrderRow; now?: Date }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const clock = order.paidAt ? callClock(order.paidAt, now) : null;
  const tier = tierByKey(order.tier);

  return (
    <li className={`rounded-xl border bg-card p-3 ${clock?.overdue ? "border-destructive/50" : "border-border"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{order.name}</p>
          <p className="text-sm text-muted-foreground">{order.address}</p>
          <p className="mt-0.5 text-sm">
            {tier?.label ?? order.tier} · paid <span className="font-semibold">{dollars(order.amountCents)}</span>
            {order.lawnSqft ? <span className="text-muted-foreground"> · county says about {order.lawnSqft.toLocaleString("en-US")} sq ft</span> : null}
          </p>
          {order.tierMoved && (
            <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" /> They changed the size from what the county showed. Check it on the call.
            </p>
          )}
        </div>
        {clock && (
          <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${clock.overdue ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
            <Clock className="h-3.5 w-3.5" /> {clock.label}
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a href={`tel:${order.phone}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground">
          <Phone className="h-4 w-4" /> Call {order.phone}
        </a>
        {order.jobId && (
          <Link href={`/jobs/${order.jobId}`} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted">
            Open job to schedule
          </Link>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          disabled={busy || done}
          onClick={() =>
            start(async () => {
              const result = await markMowCalled(order.id);
              if (!result.ok) setError(result.message);
              else setDone(true);
            })
          }
        >
          <Check className="mr-1 h-4 w-4" /> {done ? "Marked called" : "Called them"}
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </li>
  );
}
