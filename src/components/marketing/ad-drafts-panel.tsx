"use client";

import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { launchAdDraft, makeAdDraftsNow, skipAdDraft } from "@/lib/actions/ad-draft-actions";
import { adsTracker } from "@/lib/ads-tracker";
import type { AdDraft } from "@/lib/data/ad-drafts";
import type { DatedAdSpend } from "@/lib/data/ads-tracker";
import type { LeadRecord } from "@/lib/data/lead-sources";
import { BUDGET_STEPS_CENTS, estimateReturn, performanceFrom, suggestBudgetCents } from "@/lib/marketing/ad-draft";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * Ads made from finished-job photos, waiting for the owner: the photo, the
 * words, a suggested daily budget from how the ads have been doing over the
 * last 90 days, and what it should bring back. Approve launches it live.
 */
export function AdDraftsPanel({
  drafts,
  spend,
  leads,
  now,
  demo = false,
}: {
  drafts: AdDraft[];
  spend: DatedAdSpend[];
  leads: LeadRecord[];
  now: string;
  /** For the review page: the buttons only show what would happen. */
  demo?: boolean;
}) {
  const performance = useMemo(() => {
    const since = new Date(now).getTime() - 90 * 86_400_000;
    const sinceDay = new Date(since).toISOString().slice(0, 10);
    return performanceFrom(adsTracker(spend.filter((s) => s.day >= sinceDay), leads.filter((l) => new Date(l.createdAt).getTime() >= since)));
  }, [spend, leads, now]);
  const suggested = suggestBudgetCents(performance);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = drafts.filter((d) => !hidden.has(d.id));

  return (
    <section id="ad-drafts" className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">New ads to approve</h2>
          <p className="text-sm text-muted-foreground">
            Made from the crew&apos;s finished-job photos. Nothing goes to Google until you approve; then it goes live.
          </p>
        </div>
        {!demo && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await makeAdDraftsNow();
                setNote(r.ok ? (r.value ? `${r.value} new ad${r.value === 1 ? "" : "s"} made.` : "No new finished-job photos to make ads from.") : r.error);
              })
            }
          >
            Check for new photos
          </Button>
        )}
      </div>
      {note && <p className="mt-2 text-sm font-medium">{note}</p>}
      {shown.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No new ads waiting. One is made for every finished job with an after photo.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {shown.map((d) => (
            <DraftCard
              key={d.id}
              draft={d}
              suggested={suggested}
              performance={performance}
              demo={demo}
              pending={pending}
              onDone={(msg) => {
                setHidden((h) => new Set(h).add(d.id));
                setNote(msg);
              }}
              onError={setNote}
              start={start}
            />
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {performance.fromHistory
          ? `Estimates use your Google ads over the last 90 days: ${money(performance.costPerLead)} a lead, ${Math.round(performance.closeRate * 100)}% of leads sold, ${money(performance.averageJob)} a job.`
          : `No Google ads history yet, so estimates start from a guess (${money(performance.costPerLead)} a lead, ${Math.round(performance.closeRate * 100)}% sold, ${money(performance.averageJob)} a job) and the budget starts at the lowest.`}
      </p>
    </section>
  );
}

function DraftCard({
  draft,
  suggested,
  performance,
  demo,
  pending,
  onDone,
  onError,
  start,
}: {
  draft: AdDraft;
  suggested: number;
  performance: ReturnType<typeof performanceFrom>;
  demo: boolean;
  pending: boolean;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
  start: (fn: () => Promise<void>) => void;
}) {
  const [budget, setBudget] = useState(suggested);
  const est = estimateReturn(budget, performance);
  return (
    <div className="grid gap-3 rounded-lg border border-border/60 p-3 sm:grid-cols-[200px_1fr]">
      <div className="aspect-[4/3] overflow-hidden rounded-md bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link, not a static asset */}
        {draft.photoUrl ? <img src={draft.photoUrl} alt="Finished job" className="h-full w-full object-cover" /> : null}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{draft.name}</p>
        <p className="font-semibold text-blue-700 dark:text-blue-400">{draft.headlines.slice(0, 3).join(" | ")}</p>
        <p className="text-sm">{draft.descriptions[0]}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Shows for: {draft.keywords.slice(0, 4).join(", ")}
          {draft.zip ? ` · within 10 miles of ${draft.zip}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-sm">Daily budget:</span>
          {BUDGET_STEPS_CENTS.map((c) => (
            <Button key={c} size="sm" variant={c === budget ? "default" : "outline"} onClick={() => setBudget(c)}>
              ${c / 100}
              {c === suggested ? " ★" : ""}
            </Button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            ["Spend / 30 days", money(est.spend)],
            ["Leads", String(est.leads)],
            ["Jobs", String(est.jobs)],
            ["Revenue", money(est.revenue)],
            ["Back per $1", `$${est.returnPerDollar.toFixed(2)}`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md bg-muted/50 p-2">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="font-bold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            disabled={pending}
            onClick={() =>
              demo
                ? onDone(`Approved: live in Google Ads at $${budget / 100} a day.`)
                : start(async () => {
                    const r = await launchAdDraft(draft.id, budget, est);
                    if (r.ok) onDone(r.value);
                    else onError(r.error);
                  })
            }
          >
            Approve and launch
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              demo
                ? onDone("Skipped.")
                : start(async () => {
                    const r = await skipAdDraft(draft.id);
                    if (r.ok) onDone("Skipped.");
                    else onError(r.error);
                  })
            }
          >
            Skip
          </Button>
        </div>
      </div>
    </div>
  );
}
