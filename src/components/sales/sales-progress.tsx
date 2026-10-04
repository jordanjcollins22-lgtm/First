import Link from "next/link";
import { AlertTriangle, CheckCircle2, MapPin, Send, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { SALES_STEPS, salesStepState } from "@/lib/sales-progress";
import type { SaleInProgress } from "@/lib/data/sales-progress";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;

/**
 * Sales: every proposal between the walkthrough and the client's answer,
 * one card each, with a bar for where it has got to, when it went out, and
 * what to do about anything that has sat too long.
 */
export function SalesProgress({ sales }: { sales: SaleInProgress[] }) {
  if (sales.length === 0) {
    return <p className="rounded-xl border border-border bg-card/60 px-3 py-3 text-sm text-muted-foreground">No proposals out right now.</p>;
  }
  const open = sales.filter((s) => !s.stage.outcome);
  const won = sales.filter((s) => s.stage.outcome === "won");
  const lost = sales.filter((s) => s.stage.outcome === "lost").length;
  const waitingCents = open.reduce((sum, s) => sum + (s.totalCents ?? 0), 0);
  const needYou = open.filter((s) => s.stage.issues.length > 0).length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {open.length} out{waitingCents > 0 ? ` · ${money(waitingCents)} waiting` : ""}
        {needYou > 0 ? ` · ${needYou} need you` : ""}
        {won.length > 0 ? ` · ${won.length} sold this week` : ""}
        {lost > 0 ? ` · ${lost} declined this week` : ""}
      </p>
      <ul className="flex flex-col gap-3">
        {sales.map((s) => (
          <SaleCard key={s.jobId} sale={s} />
        ))}
      </ul>
    </div>
  );
}

function SaleCard({ sale: s }: { sale: SaleInProgress }) {
  const { stage } = s;
  return (
    <li
      className={cn(
        "rounded-2xl border bg-card p-3 shadow-sm",
        stage.urgent ? "border-red-400" : stage.outcome === "won" ? "border-emerald-400" : stage.issues.length > 0 ? "border-amber-400" : "border-border"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/jobs/${s.jobId}`} className="min-w-0">
          <p className="font-semibold">
            {s.client}
            {s.totalCents != null && s.totalCents > 0 && <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">{money(s.totalCents)}</span>}
          </p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{s.address}</span>
          </p>
          {s.sentAt && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Send className="h-3 w-3 shrink-0" /> Sent {day(s.sentAt)}
            </p>
          )}
        </Link>
        {stage.outcome === "won" ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
            <CheckCircle2 className="h-3 w-3" /> Sold
          </span>
        ) : stage.outcome === "lost" ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            <XCircle className="h-3 w-3" /> Declined
          </span>
        ) : stage.urgent ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">
            <AlertTriangle className="h-3 w-3" /> Needs you now
          </span>
        ) : null}
      </div>

      <div className="mt-3" aria-label={`Step: ${stage.now}`}>
        <div className="flex gap-1">
          {SALES_STEPS.map((step, i) => {
            const st = salesStepState(i, stage);
            return (
              <div
                key={step}
                className={cn("h-2.5 flex-1 rounded-full", st === "done" ? "bg-emerald-500" : st === "now" ? "animate-pulse bg-sky-500" : st === "lost" ? "bg-red-400" : "bg-muted")}
              />
            );
          })}
        </div>
        <div className="mt-1 flex gap-1">
          {SALES_STEPS.map((step, i) => {
            const st = salesStepState(i, stage);
            return (
              <span
                key={step}
                className={cn(
                  "flex-1 text-center text-[10px] leading-tight",
                  st === "now" ? "font-semibold text-foreground" : st === "done" ? "text-emerald-700" : st === "lost" ? "font-semibold text-red-700" : "text-muted-foreground"
                )}
              >
                {step}
              </span>
            );
          })}
        </div>
      </div>

      <p className="mt-2 text-sm">
        <span className="font-medium">{stage.now}</span>
        {stage.since && <span className="text-xs text-muted-foreground"> · {day(stage.since)}</span>}
      </p>
      {stage.issues.map((issue) => (
        <p key={issue} className={cn("mt-1 rounded-lg px-2 py-1 text-xs", stage.urgent ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900")}>
          {issue}
        </p>
      ))}
      {!stage.outcome && stage.issues.length > 0 && (
        <Link href={s.actionHref} className="mt-3 flex h-11 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
          {s.actionHref.startsWith("/conversations") ? "Answer them" : s.actionHref.startsWith("/sales") ? (stage.step <= 1 ? "Price it" : "Send it") : "Open the job"}
        </Link>
      )}
    </li>
  );
}
