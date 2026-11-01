"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Copy, ExternalLink } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { dollars } from "@/lib/tap-estimate";
import { RUN_STAGES, type TestRun } from "@/lib/test-runs";
import { cn } from "@/lib/utils";

type SortKey = "started" | "name" | "stage" | "total" | "minutes";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "started", label: "Newest" },
  { key: "name", label: "Name" },
  { key: "stage", label: "How far" },
  { key: "total", label: "Estimate" },
  { key: "minutes", label: "Time taken" },
];

function compare(a: TestRun, b: TestRun, key: SortKey): number {
  switch (key) {
    case "started":
      return a.startedAt.localeCompare(b.startedAt);
    case "name":
      return a.name.localeCompare(b.name);
    case "stage":
      return a.stage - b.stage;
    case "total":
      return (a.totalCents ?? -1) - (b.totalCents ?? -1);
    case "minutes":
      return a.minutes - b.minutes;
  }
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function took(m: number): string {
  if (m < 1) return "under a minute";
  if (m < 90) return `${Math.round(m)} min`;
  return `${Math.round(m / 60)} hr`;
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-2 py-1.5 text-xs">{link}</code>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:border-primary hover:text-primary"
        onClick={() => {
          navigator.clipboard
            .writeText(link)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => {});
        }}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/**
 * Every run of the booking funnel from a test link: who, where, what they
 * asked for, the estimate they got, what they chose and how far they got.
 * Sorted on the page, newest first to start.
 */
export function TestRunsView({ runs, problems, link }: { runs: TestRun[]; problems: string[]; link: string | null }) {
  const [sort, setSort] = useState<SortKey>("started");
  const [descending, setDescending] = useState(true);
  const sorted = useMemo(() => [...runs].sort((a, b) => (descending ? -1 : 1) * compare(a, b, sort)), [runs, sort, descending]);

  const reached = RUN_STAGES.map((_, i) => runs.filter((r) => r.stage >= i + 1).length);
  const priced = runs.filter((r) => r.totalCents != null && r.totalCents > 0);
  const average = priced.length ? priced.reduce((sum, r) => sum + (r.totalCents ?? 0), 0) / priced.length : null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Test runs</h1>
        <p className="text-sm text-muted-foreground">
          Everybody who went through the booking funnel from the test link. It works like the real one, but nothing is charged, no
          visit is booked, and none of it counts on the Funnel or Pricing health pages. Their jobs are named &ldquo;TEST&rdquo;.
        </p>
      </header>

      {link && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-medium">The test link</p>
            <CopyLink link={link} />
          </CardContent>
        </Card>
      )}

      {problems.map((p) => (
        <p key={p} className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {p}
        </p>
      ))}

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {RUN_STAGES.map((label, i) => (
          <div key={label} className="rounded-lg border border-border bg-card/60 p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold tabular-nums">{reached[i]}</p>
          </div>
        ))}
        <div className="rounded-lg border border-border bg-card/60 p-3">
          <p className="text-xs text-muted-foreground">Average estimate</p>
          <p className="text-2xl font-semibold tabular-nums">{average != null ? dollars(average) : "–"}</p>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Sort by</span>
        {SORTS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              if (s.key === sort) setDescending((d) => !d);
              else {
                setSort(s.key);
                setDescending(s.key !== "name");
              }
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm",
              s.key === sort ? "border-primary! bg-primary text-primary-foreground" : "border-border hover:border-primary"
            )}
          >
            {s.label}
            {s.key === sort && (descending ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />)}
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No test runs yet. Send somebody the test link above; their run shows here as soon as they put in their details.
        </p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((run) => (
            <li key={run.jobId}>
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{run.name}</p>
                      <p className="text-sm text-muted-foreground">{run.address ?? "No address"}</p>
                      <p className="text-xs text-muted-foreground">
                        {[run.email, run.phone].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>Started {when(run.startedAt)}</p>
                      <p>Took {took(run.minutes)}</p>
                    </div>
                  </div>

                  <ol className="flex flex-wrap gap-1">
                    {RUN_STAGES.map((label, i) => (
                      <li
                        key={label}
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs",
                          i < run.stage ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                        )}
                      >
                        {i < run.stage ? "✓ " : ""}
                        {label}
                      </li>
                    ))}
                  </ol>

                  {run.spots.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[520px] text-sm">
                        <thead>
                          <tr className="text-left text-xs text-muted-foreground">
                            <th className="py-1 pr-3 font-medium">Spot</th>
                            <th className="py-1 pr-3 font-medium">What they asked for</th>
                            <th className="py-1 pr-3 font-medium">Size</th>
                            <th className="py-1 text-right font-medium">Before cushion</th>
                          </tr>
                        </thead>
                        <tbody>
                          {run.spots.map((s) => (
                            <tr key={s.number} className="border-t border-border">
                              <td className="py-1.5 pr-3 tabular-nums">{s.number}</td>
                              <td className="py-1.5 pr-3">{s.asked}</td>
                              <td className="py-1.5 pr-3 text-muted-foreground">
                                {s.size ?? "–"}
                                {s.sizedBy ? ` (${s.sizedBy})` : ""}
                              </td>
                              <td className="py-1.5 text-right tabular-nums">{s.priceCents != null ? dollars(s.priceCents) : "On the visit"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                    {run.totalCents != null && (
                      <span>
                        Estimate <strong className="tabular-nums">{dollars(run.totalCents)}</strong>
                      </span>
                    )}
                    {run.chose && <span>Chose: {run.chose}</span>}
                    {run.picked && <span>Picked: {run.picked}</span>}
                    {run.photoFlag && (
                      <span className="font-medium text-amber-600 dark:text-amber-400">
                        {run.photoFlag === "wrong_property" ? "Said the photo isn't their property" : "Said the photo is out of date"}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-3 text-sm">
                    {run.token && run.totalCents != null && (
                      <a href={`/prep/${run.token}/estimate`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                        See their estimate <ExternalLink className="size-3.5" />
                      </a>
                    )}
                    <Link href={`/jobs/${run.jobId}`} className="font-medium text-primary hover:underline">
                      Open the job{run.jobNumber ? ` #${run.jobNumber}` : ""}
                    </Link>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
