"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertTriangle, BarChart3, CalendarDays, Check, Clock, Loader2, Mail, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { markMowCalled, previewMowWelcome, sendMowWelcome } from "@/lib/actions/mow-order-actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dayLabel } from "@/lib/mow-days";
import type { MowOrderRow } from "@/lib/data/mow-orders";
import { callClock } from "@/lib/mow-calls";
import { dollars, tierByKey } from "@/lib/mow-price";
import { QUICK_MOW_STAGES, type QuickMowStage } from "@/lib/quick-mow-pipeline";
import { formatJobNumber } from "@/lib/job-number";
import { shortWhen } from "@/lib/time-zone";

/**
 * The quick mow pipeline: every request from the quick mow page, in the
 * column it has reached, from a price seen to a lawn mowed. Each card says
 * what to do next and has the button to do it. Kept apart from the loading
 * so it can be previewed with sample requests.
 */
export function MowOrdersBoard({ orders, now }: { orders: MowOrderRow[] | null; now?: Date }) {
  const [stage, setStage] = useState<QuickMowStage | "all">("all");
  const by = (key: QuickMowStage) => (orders ?? []).filter((o) => o.stage === key);
  const paidTotal = (orders ?? []).filter((o) => o.status === "paid").reduce((sum, o) => sum + (o.amountCents ?? 0), 0);
  const shown = QUICK_MOW_STAGES.filter((s) => stage === "all" || s.key === stage);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6">
      <header>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold">Quick mow pipeline</h1>
          <Link href="/mow-orders/funnel" className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            <BarChart3 className="h-4 w-4" /> Funnel scoreboard
          </Link>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Everybody who asked for a price on the quick mow page, in the system as a client with a job from the moment they gave their
          details. Call within 2 minutes of them asking or paying.
        </p>
        {orders && (
          <p className="mt-2 text-sm">
            <span className="font-semibold">{orders.length} requests</span>
            <span className="text-muted-foreground">
              {" "}
              · {(orders ?? []).filter((o) => o.status === "paid").length} paid · {dollars(paidTotal)} taken
            </span>
          </p>
        )}
      </header>

      {orders === null && <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">Couldn&apos;t load the pipeline just now. Reload the page.</p>}

      {/* The funnel at a glance; tap a stage to see only it. */}
      <nav className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Stages">
        {QUICK_MOW_STAGES.map((s) => {
          const count = by(s.key).length;
          const on = stage === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setStage(on ? "all" : s.key)}
              aria-pressed={on}
              className={`rounded-xl border px-2 py-2 text-left transition-colors ${on ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"} ${
                s.key === "to_call" && count > 0 ? "ring-1 ring-amber-400" : ""
              }`}
            >
              <span className="block text-2xl font-bold tabular-nums">{count}</span>
              <span className="block text-xs leading-tight text-muted-foreground">{s.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="space-y-5">
        {shown.map((s) => {
          const rows = by(s.key).sort((a, b) =>
            s.key === "to_call" ? (a.paidAt ?? "").localeCompare(b.paidAt ?? "") : s.key === "scheduled" ? (a.visitOn ?? "").localeCompare(b.visitOn ?? "") : b.createdAt.localeCompare(a.createdAt)
          );
          if (stage === "all" && rows.length === 0 && (s.key === "lost" || s.key === "mowed")) return null;
          return (
            <section key={s.key} className="space-y-2">
              <div>
                <h2 className="text-base font-semibold">
                  {s.label} <span className="text-muted-foreground">({rows.length})</span>
                </h2>
                <p className="text-xs text-muted-foreground">{s.blurb}</p>
              </div>
              {rows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">Nobody here.</p>
              ) : (
                <ul className="grid gap-2 md:grid-cols-2">
                  {rows.map((o) => (
                    <RequestCard key={o.id} order={o} now={now} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function RequestCard({ order, now }: { order: MowOrderRow; now?: Date }) {
  const [called, setCalled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const tier = order.tier ? tierByKey(order.tier) : null;
  // Speed to lead: two minutes from asking, or from paying, until somebody calls.
  const since = order.stage === "to_call" ? order.paidAt : order.stage === "requested" && !order.calledAt ? order.createdAt : null;
  const clock = since ? callClock(since, now) : null;
  const [draft, setDraft] = useState<{ to: string; subject: string; body: string } | null>(null);
  const [emailed, setEmailed] = useState<string | null>(order.welcomeSentAt);

  return (
    <li className={`rounded-xl border bg-card p-3 ${clock?.overdue ? "border-destructive/50" : "border-border"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">
            {order.name}
            {order.jobNumber != null && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{formatJobNumber(order.jobNumber)}</span>}
          </p>
          <p className="truncate text-sm text-muted-foreground">{order.address}</p>
        </div>
        {clock && (
          <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${clock.overdue ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
            <Clock className="h-3.5 w-3.5" /> {clock.label}
          </span>
        )}
      </div>

      <p className="mt-1 text-sm">
        {tier ? tier.label : "No price yet (no county lot, or over an acre)"}
        {order.status === "paid" ? (
          <>
            {" "}
            · paid <span className="font-semibold">{dollars(order.amountCents ?? 0)}</span>
          </>
        ) : order.amountCents ? (
          <span className="text-muted-foreground"> · saw {dollars(order.amountCents)}</span>
        ) : null}
      </p>
      <p className="text-xs text-muted-foreground">
        Asked {shortWhen(order.createdAt)}
        {order.referralCode ? ` · from link ${order.referralCode}` : ""}
        {order.lawnSqft ? ` · county lawn about ${order.lawnSqft.toLocaleString("en-US")} sq ft` : ""}
      </p>
      {order.mowDay && (order.stage === "to_call" || order.stage === "to_schedule") && (
        <p className="mt-1 flex items-center gap-1 text-sm font-medium">
          <CalendarDays className="h-4 w-4 text-primary" /> Picked {dayLabel(order.mowDay)}
          {order.stage === "to_call" ? <span className="font-normal text-muted-foreground"> · confirm it on the call</span> : null}
        </p>
      )}
      {order.visitOn && order.stage === "scheduled" && (
        <p className="mt-1 flex items-center gap-1 text-sm font-medium">
          <CalendarDays className="h-4 w-4 text-primary" /> {new Date(`${order.visitOn}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
        </p>
      )}
      {order.tierMoved && order.status === "paid" && (
        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5" /> They changed the size from what the county showed. Check it on the call.
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <a href={`tel:${order.phone}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground">
          <Phone className="h-4 w-4" /> {order.phone}
        </a>
        {order.jobId && (
          <Link href={`/jobs/${order.jobId}`} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted">
            {order.stage === "to_schedule" ? "Open job to schedule" : "Open job"}
          </Link>
        )}
        {(order.stage === "to_call" || (order.stage === "requested" && !order.calledAt)) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            disabled={busy || called}
            onClick={() =>
              start(async () => {
                const result = await markMowCalled(order.id);
                if (!result.ok) setError(result.message);
                else setCalled(true);
              })
            }
          >
            <Check className="mr-1 h-4 w-4" /> {called ? "Marked called" : "Called them"}
          </Button>
        )}
      </div>
      {order.status === "paid" && order.stage !== "mowed" && !draft && (
        <div className="mt-2">
          {emailed ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Mail className="h-3.5 w-3.5" /> Before-your-mow email sent {shortWhen(emailed)}
            </p>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-primary"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const result = await previewMowWelcome(order.id);
                  if (!result.ok) setError(result.message);
                  else setDraft({ to: result.to, subject: result.subject, body: result.body });
                })
              }
            >
              <Mail className="mr-1 h-4 w-4" /> Before-your-mow email
            </Button>
          )}
        </div>
      )}
      {draft && (
        <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/30 p-2">
          <p className="text-xs font-semibold">Goes to {draft.to}. Change anything; nothing sends until you press Send.</p>
          <Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} aria-label="Subject" />
          <Textarea rows={10} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} aria-label="Email" />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const result = await sendMowWelcome({ id: order.id, subject: draft.subject, body: draft.body });
                  if (!result.ok) return setError(result.message);
                  setDraft(null);
                  setEmailed(new Date().toISOString());
                })
              }
            >
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Send email
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </li>
  );
}
