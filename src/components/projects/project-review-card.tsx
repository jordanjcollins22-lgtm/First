"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { findClients, recordReferral, setFiveStarReview } from "@/lib/actions/project-review-actions";
import type { ProjectReviewRow } from "@/lib/data/project-review";
import type { Score } from "@/lib/project-review";

const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

const tone = (good: boolean) =>
  good
    ? "border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
    : "border-red-500 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200";

/**
 * The project review, one card: who and where, the price and the profit,
 * then five squares -- issues, hours, cost, a five-star review, a referral --
 * each green when it is good and red when it is not. On the project's own
 * page it also lists the issues and takes the review and the referral.
 */
export function ProjectReviewCard({ row, interactive = false, href }: { row: ProjectReviewRow; interactive?: boolean; href?: string }) {
  const r = row.review;
  const head = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-base font-bold leading-tight">{row.client}</p>
        <p className="truncate text-xs text-muted-foreground">{row.address}</p>
      </div>
      <div className="flex shrink-0 items-start gap-3 text-right">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Price</p>
          <p className="text-xl font-bold tabular-nums">{dollars(row.priceCents)}</p>
        </div>
        <div className={cn("rounded-lg border-2 px-2 py-0.5", tone(r.profit.good))}>
          <p className="text-[10px] font-semibold uppercase tracking-wide">Profit</p>
          <p className="text-xl font-bold tabular-nums">{r.profit.value}</p>
        </div>
      </div>
    </div>
  );
  const squares = (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      <Square label="Number of issues" score={r.issues} />
      <Square label="Budgeted hours vs real hours" score={r.hours} />
      <Square label="Budgeted cost vs real cost" score={r.cost} />
      <Square label="Did they leave a 5-star review?" score={r.review} />
      <Square label="Did they refer us?" score={r.referral} />
    </div>
  );

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      {href ? (
        <Link href={href} className="hover:underline">
          {head}
        </Link>
      ) : (
        head
      )}
      {row.preview && (
        <p className="rounded-lg bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
          Not said yes to yet. This is how it starts; it keeps itself up to date from the day the work begins.
        </p>
      )}
      {squares}
      <p className="text-[11px] text-muted-foreground">
        {r.profit.detail}.{" "}
        {row.final
          ? `Real cost as signed off: ${row.final.crewHours} crew-hrs at the crew rate, $${Math.round(row.final.materialsCents / 100).toLocaleString("en-US")} materials, $${Math.round(row.final.otherCents / 100).toLocaleString("en-US")} else${row.finalNote ? ` (${row.finalNote})` : ""}.`
          : "Real cost is clocked hours at the crew rate, the materials, and receipts."}
      </p>
      {interactive && <Details row={row} />}
    </section>
  );
}

function Square({ label, score }: { label: string; score: Score }) {
  return (
    <div className={cn("flex min-h-[7rem] flex-col rounded-xl border-2 p-2", tone(score.good))}>
      <p className="text-[11px] font-medium leading-tight">{label}</p>
      {score.pair ? (
        // Budget over real: the pair never has to squeeze onto one line.
        <div className="my-auto grid grid-cols-[auto_1fr] items-baseline gap-x-1.5 px-1 tabular-nums">
          <span className="text-[10px] font-semibold uppercase opacity-80">Budget</span>
          <span className="whitespace-nowrap text-right text-lg font-semibold">{score.pair.budget}</span>
          <span className="text-[10px] font-semibold uppercase opacity-80">Real</span>
          <span className="whitespace-nowrap text-right text-2xl font-bold">{score.pair.real}</span>
        </div>
      ) : (
        <p className="my-auto text-center text-3xl font-bold tabular-nums">{score.value}</p>
      )}
      <p className="text-center text-[11px] leading-tight opacity-90">{score.detail}</p>
    </div>
  );
}

/** The issues, each with what was done and what stops it happening again; the review and the referral, to set. */
function Details({ row }: { row: ProjectReviewRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ id: string; name: string }[]>([]);

  function run(task: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    start(async () => {
      const result = await task();
      if (!result.ok) return setError(result.error);
      setQuery("");
      setFound([]);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <div>
        <p className="text-sm font-semibold">Issues</p>
        {row.issues.length === 0 ? (
          <p className="text-xs text-muted-foreground">None. Any issue on this job turns the square red.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1.5">
            {row.issues.map((issue) => {
              const done = !issue.open && Boolean(issue.prevention?.trim());
              return (
                <li key={issue.id} className={cn("rounded-lg border px-2.5 py-1.5 text-xs", done ? "border-border" : "border-red-400 bg-red-50/60 dark:bg-red-950/30")}>
                  <p className="flex items-center gap-1.5 font-medium">
                    {done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-red-600" />}
                    {issue.title}
                    <span className="font-normal text-muted-foreground">· {issue.kind === "ticket" ? "crew ticket" : "issue"}</span>
                  </p>
                  {issue.open ? (
                    <p className="text-red-800 dark:text-red-300">Still open. Put it right on this project, and say what changes so it can&apos;t happen again.</p>
                  ) : (
                    <>
                      <p className="text-muted-foreground">Done: {issue.resolution ?? "not said"}</p>
                      <p className={issue.prevention ? "text-muted-foreground" : "text-red-800 dark:text-red-300"}>
                        So it can&apos;t happen again: {issue.prevention ?? "not said yet"}
                      </p>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold">5-star review?</p>
        {([true, false] as const).map((value) => (
          <button
            key={String(value)}
            type="button"
            disabled={pending}
            onClick={() => run(() => setFiveStarReview(row.jobId, row.fiveStarMarked === value ? null : value))}
            className={cn(
              "rounded-md border px-3 py-1 text-sm font-medium",
              row.fiveStarMarked === value ? (value ? "border-emerald-600 bg-emerald-600 text-white" : "border-red-600 bg-red-600 text-white") : "border-border"
            )}
          >
            {value ? "Yes" : "No"}
          </button>
        ))}
        <span className="text-xs text-muted-foreground">{row.review.review.detail}</span>
      </div>

      {row.customerId && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold">Did they refer someone?</p>
          <input
            value={query}
            onChange={(e) => {
              const q = e.target.value;
              setQuery(q);
              if (q.trim().length >= 2) findClients(q).then((list) => setFound(list.filter((c) => c.id !== row.customerId)));
              else setFound([]);
            }}
            placeholder="Type the name of the client they sent"
            className="min-h-10 rounded-md border border-border bg-background px-2 text-sm"
          />
          {found.length > 0 && (
            <ul className="flex flex-col rounded-md border border-border">
              {found.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => recordReferral(row.jobId, row.customerId!, c.id))}
                    className="w-full px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">{row.review.referral.good ? `Sent us: ${row.review.referral.detail}` : "Nobody yet."}</p>
        </div>
      )}
      {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
