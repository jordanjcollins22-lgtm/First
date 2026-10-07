"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { decideAdvance, payAdvance, requestAdvance, withdrawAdvance } from "@/lib/actions/commission-advance-actions";
import { ADVANCE_STATUS_LABEL, type AdvanceStatus } from "@/lib/commission-advance";
import type { AdvanceBook, AdvanceRow } from "@/lib/data/commission-advances";

const money = (n: number) =>
  `$${n.toLocaleString("en-US", Number.isInteger(n) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const STATUS_TONE: Record<AdvanceStatus, string> = {
  requested: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  approved: "bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200",
  paid: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
  declined: "bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-200",
  cancelled: "bg-muted text-muted-foreground",
};

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  function run(task: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>, then?: () => void) {
    setMessage(null);
    start(async () => {
      const result = await task();
      setMessage(result.ok ? { ok: true, text: result.message } : { ok: false, text: result.error });
      if (result.ok) {
        then?.();
        router.refresh();
      }
    });
  }
  return { pending, message, run };
}

function Status({ status }: { status: AdvanceStatus }) {
  return <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", STATUS_TONE[status])}>{ADVANCE_STATUS_LABEL[status]}</span>;
}

/**
 * The account manager's side: ask for an advance on a project, up to what
 * its commission will still pay, and see every one asked for and where it
 * stands.
 */
export function AdvanceRequest({ book, advances }: { book: Pick<AdvanceBook, "limit" | "owed" | "pending" | "projects">; advances: AdvanceRow[] }) {
  const { pending, message, run } = useRun();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3">
      <div>
        <h3 className="font-semibold">Advances</h3>
        <p className="text-xs text-muted-foreground">
          Money now, owed back from your commission: every commission payout pays back what you owe first, then the rest comes to you.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className={cn("rounded-lg border p-2", book.owed > 0 ? "border-amber-400 bg-amber-50/60 dark:bg-amber-950/30" : "border-border")}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">You owe</p>
          <p className="text-lg font-bold tabular-nums">{money(book.owed)}</p>
          <p className="text-[11px] text-muted-foreground">{book.owed > 0 ? "Comes out of your next commission" : "Nothing owed"}</p>
        </div>
        <div className="rounded-lg border border-border p-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">You can ask for</p>
          <p className="text-lg font-bold tabular-nums">{money(book.limit)}</p>
          <p className="text-[11px] text-muted-foreground">Commission to come on jobs paid in full</p>
        </div>
      </div>
      {book.limit <= 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing to ask for right now. An advance is covered by commission to come on jobs the client has paid in full
          {book.owed > 0 ? ", less what you owe" : ""}.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium">
            How much
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={String(Math.floor(book.limit))}
                className="h-10 w-full rounded-md border border-border bg-background pl-6 pr-2 text-sm"
              />
            </div>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            What it&apos;s for
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="A word on why" className="h-10 rounded-md border border-border bg-background px-2 text-sm" />
          </label>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () => requestAdvance({ amount: Number(amount.replace(/[$,\s]/g, "")), reason }),
                () => {
                  setAmount("");
                  setReason("");
                }
              )
            }
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Ask for an advance
          </Button>
          {book.projects.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Covered by: {book.projects.map((p) => `${p.client} ${money(p.room)}`).join(" · ")}
            </p>
          )}
        </div>
      )}
      {message && <p className={cn("text-sm", message.ok ? "text-emerald-700" : "text-destructive")}>{message.text}</p>}

      {advances.length > 0 && (
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {advances.map((a) => (
            <li key={a.id} className="flex flex-col gap-0.5 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {money(a.amount)} {a.client && <span className="font-normal text-muted-foreground">on {a.client}</span>}
                </span>
                <Status status={a.status} />
              </div>
              <p className="text-xs text-muted-foreground">
                Asked {day(a.requestedAt)}
                {a.reason ? `: ${a.reason}` : ""}
                {a.paidAt ? ` · paid ${day(a.paidAt)}${a.method ? ` by ${a.method}` : ""}` : ""}
              </p>
              {a.decisionNote && <p className="text-xs">&ldquo;{a.decisionNote}&rdquo;</p>}
              {a.status === "requested" && (
                <button type="button" disabled={pending} onClick={() => run(() => withdrawAdvance(a.id))} className="self-start text-xs text-muted-foreground underline">
                  Withdraw it
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const METHODS = ["Zelle", "Cash", "Check", "Venmo", "Bank transfer", "Other"];

/**
 * The owner's side: every advance asked for. Approve or decline one waiting,
 * pay one approved, and see the ones done with underneath.
 */
export function AdvanceApprovals({ advances }: { advances: AdvanceRow[] }) {
  const waiting = advances.filter((a) => a.status === "requested");
  const toPay = advances.filter((a) => a.status === "approved");
  const done = advances.filter((a) => a.status === "paid" || a.status === "declined").slice(0, 10);
  if (advances.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">Commission advances</h3>
        <span className="text-xs text-muted-foreground">
          {waiting.length} to approve · {toPay.length} to pay
        </span>
      </div>
      {[...waiting, ...toPay].map((a) => (
        <AdvanceToAnswer key={a.id} advance={a} />
      ))}
      {waiting.length + toPay.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting.</p>}
      {done.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Done with ({done.length})</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {done.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 text-xs">
                <span>
                  {a.person}: {money(a.amount)}
                  {a.client ? ` on ${a.client}` : ""}
                  {a.paidAt ? `, paid ${day(a.paidAt)}${a.method ? ` by ${a.method}` : ""}${a.reference ? ` (${a.reference})` : ""}` : ""}
                </span>
                <Status status={a.status} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function AdvanceToAnswer({ advance: a }: { advance: AdvanceRow }) {
  const { pending, message, run } = useRun();
  const [note, setNote] = useState("");
  const [method, setMethod] = useState(METHODS[0]);
  const [reference, setReference] = useState("");
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {a.person} asks {money(a.amount)} {a.client && <span className="font-normal text-muted-foreground">on {a.client}</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            {day(a.requestedAt)}
            {a.reason ? `: ${a.reason}` : ""}
          </p>
        </div>
        <Status status={a.status} />
      </div>
      {a.status === "requested" ? (
        <>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note to them (needed to decline)" className="h-9 rounded-md border border-border bg-background px-2 text-sm" />
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={() => run(() => decideAdvance(a.id, true, note))}>
              Approve
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => decideAdvance(a.id, false, note))}>
              Decline
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium">
            Paid by
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="flex min-w-32 flex-1 flex-col gap-1 text-xs font-medium">
            Reference
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" className="h-9 rounded-md border border-border bg-background px-2 text-sm" />
          </label>
          <Button type="button" size="sm" disabled={pending} onClick={() => run(() => payAdvance(a.id, { method, reference }))}>
            {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Mark paid {money(a.amount)}, owed back
          </Button>
        </div>
      )}
      {message && <p className={cn("text-xs", message.ok ? "text-emerald-700" : "text-destructive")}>{message.text}</p>}
    </div>
  );
}
