"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, FileText, Loader2, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { acceptPrice, setPrice } from "@/lib/actions/price-approval-actions";
import { sendProposalToClient } from "@/lib/actions/proposal-actions";
import { readPrice } from "@/lib/price-approval";
import type { PriceApproval } from "@/lib/data/price-approvals";
import { cn } from "@/lib/utils";

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const hours = (h: number) => (h < 10 ? h.toFixed(1) : Math.round(h).toString());

/**
 * Walkthroughs waiting on the account manager, on their My Day: each one's
 * price with everything behind it, then Accept price or Decline price, then
 * Send to client.
 */
export function PriceApprovals({ items, preview = false }: { items: PriceApproval[]; preview?: boolean }) {
  const waiting = items.filter((i) => i.stage === "price").length;
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">To price</h2>
        <p className="text-sm text-muted-foreground">
          {items.length === 0
            ? "Nothing waiting. Walkthroughs land here when they are submitted."
            : waiting > 0
              ? `${waiting} walkthrough${waiting === 1 ? "" : "s"} submitted and waiting on a price.`
              : "Priced, and waiting to be sent."}
        </p>
      </div>
      {items.map((item) => (
        <PriceCard key={item.jobId} item={item} preview={preview} />
      ))}
    </section>
  );
}

export function PriceCard({
  item,
  preview = false,
  startAt,
}: {
  item: PriceApproval;
  preview?: boolean;
  /** For the preview's pages: open on a later step. */
  startAt?: "decline" | "send" | "sent";
}) {
  const router = useRouter();
  const [stage, setStage] = useState<"price" | "decline" | "send" | "sent">(startAt ?? item.stage);
  const [total, setTotal] = useState(item.totalCents);
  const [typed, setTyped] = useState("");
  const [sendTo, setSendTo] = useState<string | null>(item.email);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const b = item.breakdown;
  const worked = b.priceCents;

  function accept() {
    setError(null);
    if (preview) return setStage("send");
    start(async () => {
      const result = await acceptPrice(item.jobId);
      if (!result.ok) return setError(result.error);
      setSendTo(result.sendTo);
      setStage("send");
    });
  }

  function submitPrice() {
    setError(null);
    const price = readPrice(typed);
    if (price == null) return setError("Type the price in dollars, like 2450.");
    if (preview) {
      setTotal(Math.round(price * 100));
      return setStage("send");
    }
    start(async () => {
      const result = await setPrice(item.jobId, price);
      if (!result.ok) return setError(result.error);
      setTotal(Math.round(price * 100));
      setSendTo(result.sendTo);
      setStage("send");
    });
  }

  function send() {
    setError(null);
    if (preview) return setStage("sent");
    start(async () => {
      const result = await sendProposalToClient(item.jobId);
      if (!result.ok) return setError(result.error);
      setSendTo(result.to);
      setStage("sent");
      router.refresh();
    });
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight">{item.client}</p>
          <p className="text-sm text-muted-foreground">{item.address}</p>
          <p className="text-xs text-muted-foreground">
            Walkthrough by {item.evaluator ?? "the evaluator"}
            {item.submittedAt && `, ${new Date(item.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{stage === "price" || stage === "decline" ? "Price" : "Priced at"}</p>
          <p className="text-3xl font-bold tabular-nums">{dollars(total)}</p>
        </div>
      </div>

      {(stage === "price" || stage === "decline") && (
        <>
          <Breakdown item={item} />
          {total !== worked && worked > 0 && (
            <p className="text-xs text-muted-foreground">
              The rate card works it out at {dollars(worked)}; the price was set at {dollars(total)}.
            </p>
          )}
        </>
      )}

      {stage === "price" && (
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" className="h-14 text-base font-semibold" disabled={pending} onClick={accept}>
            {pending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Check className="mr-2 h-5 w-5" />}
            Accept price
          </Button>
          <Button type="button" variant="outline" className="h-14 text-base font-semibold" disabled={pending} onClick={() => setStage("decline")}>
            <X className="mr-2 h-5 w-5" /> Decline price
          </Button>
        </div>
      )}

      {stage === "decline" && (
        <div className="flex flex-col gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
          <label htmlFor={`price-${item.jobId}`} className="text-sm font-semibold">
            What should the price be?
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id={`price-${item.jobId}`}
                inputMode="decimal"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={String(Math.round(total / 100))}
                className="h-12 pl-7 text-lg"
                autoFocus={!preview}
              />
            </div>
            <Button type="button" className="h-12 px-5 font-semibold" disabled={pending} onClick={submitPrice}>
              {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : "Submit"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Spread across the areas so they still add up. Nothing goes to the client yet.</p>
          <button type="button" className="self-start text-xs text-muted-foreground underline" onClick={() => setStage("price")}>
            Back
          </button>
        </div>
      )}

      {stage === "send" && (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Price accepted. Review the proposal, then send it.
          </p>
          {item.proposalHref && (
            <a
              href={item.proposalHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-border bg-background font-semibold"
            >
              <FileText className="h-5 w-5" /> Review proposal
            </a>
          )}
          <Button type="button" className="h-14 text-base font-semibold" disabled={pending || (!sendTo && !preview)} onClick={send}>
            {pending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Send className="mr-2 h-5 w-5" />}
            Send to client
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {sendTo ? `Review it as the client will see it, then send. It emails to ${sendTo}.` : "No email on file. Copy the link from the proposal and text it to them."}
          </p>
        </div>
      )}

      {stage === "sent" && (
        <p className="flex items-center gap-1.5 rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> Sent to {sendTo ?? "the client"}. It is on their proposal page now.
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </article>
  );
}

/** Everything behind the price: each area, then the job's totals. */
function Breakdown({ item }: { item: PriceApproval }) {
  const b = item.breakdown;
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid grid-cols-2 gap-2">
        <Stat label="Budgeted hours" value={`${hours(b.crewHours)} crew-hrs`} />
        <Stat label="Labour" value={dollars(b.labourCents)} />
        <Stat
          label="Materials"
          value={dollars(b.materialsCents)}
          detail={b.materialTotals.length > 0 ? b.materialTotals.map((m) => `${m.amount} ${m.name.toLowerCase()}${m.cents == null ? ", no cost set" : ""}`) : ["None"]}
        />
        <Stat label="Markup & overhead" value={dollars(b.markupCents)} />
      </dl>
      <details className="rounded-xl border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
          {b.areas.length} area{b.areas.length === 1 ? "" : "s"}, area by area
        </summary>
        <ul className="flex flex-col divide-y divide-border">
          {b.areas.map((a, i) => (
            <li key={`${a.name}-${i}`} className="flex flex-col gap-1 px-3 py-2 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 font-medium">
                  {a.name} <span className="text-muted-foreground">· {a.service}</span>
                </p>
                <p className="shrink-0 font-semibold tabular-nums">{dollars(a.priceCents)}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {[a.size ?? "not measured", `${hours(a.crewHours)} crew-hrs, ${dollars(a.labourCents)} labour`, `${dollars(a.materialsCents)} materials`, `${dollars(a.markupCents)} markup & overhead`].join(" · ")}
              </p>
              {a.materials.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {a.materials.map((m) => `${m.name}: ${m.amount}${m.cents != null ? `, ${dollars(m.cents)}` : ", no cost set"}`).join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      </details>
      <p className="text-xs text-muted-foreground">
        Labour at {dollars(item.crewRateCents)} a crew-hour, marked up {item.markup}.
      </p>
      {b.warnings.map((w) => (
        <p key={w} className="rounded-lg bg-amber-100/70 px-3 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {w}
        </p>
      ))}
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string[] }) {
  return (
    <div className={cn("rounded-xl border border-border bg-background p-2.5")}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-base font-semibold tabular-nums">{value}</dd>
      {detail?.map((line) => (
        <dd key={line} className="text-xs text-muted-foreground">
          {line}
        </dd>
      ))}
    </div>
  );
}
