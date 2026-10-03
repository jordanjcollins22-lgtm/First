"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, ChevronDown, ChevronUp, Loader2, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { approveScopeRecommendation, declineScopeRecommendation, loadScopeReviews } from "@/lib/actions/scope-review-actions";
import { groupReviews, nextOpenGroup, zoneListLabel, type ReviewGroup, type ZoneReview } from "@/lib/scope-review";

/**
 * The scope review, one decision at a time.
 *
 * Every zone needs an approved scope before the proposal goes out. Zones
 * whose service and wording are identical are one decision: the group is
 * shown together and approved together, and any single zone in it can be
 * declined on its own, which gives that zone its own round. Only the next
 * open decision is on screen; the ones already made fold up underneath.
 */
export function ScopeReviewPanel({ jobId, onSettled }: { jobId: string; onSettled: (allSettled: boolean) => void }) {
  const [reviews, setReviews] = useState<ZoneReview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);

  function take(result: Awaited<ReturnType<typeof loadScopeReviews>>) {
    if (result.ok) {
      setReviews(result.value.reviews);
      onSettled(result.value.reviews.every((r) => r.settled));
      setError(null);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }

  async function refresh() {
    take(await loadScopeReviews(jobId));
  }

  useEffect(() => {
    let alive = true;
    loadScopeReviews(jobId).then((result) => {
      if (alive) take(result);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  if (loading && !reviews) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Writing the recommended scope for each zone…
      </p>
    );
  }
  if (error && !reviews) return <p className="text-xs text-destructive">{error}</p>;
  if (!reviews || reviews.length === 0) return null;

  const groups = groupReviews(reviews);
  const next = nextOpenGroup(groups);
  const done = groups.filter((g) => g.settled);
  const total = groups.length;
  const position = next ? groups.indexOf(next) + 1 : total;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-400/40 bg-amber-400/5 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Scope review</p>
          <p className="text-xs text-muted-foreground">
            {next ? `Decision ${position} of ${total}. ` : "Every zone is approved. "}
            {reviews.length} zone{reviews.length === 1 ? "" : "s"}, {done.length} of {total} decision{total === 1 ? "" : "s"} made.
          </p>
        </div>
      </div>

      {next && <GroupCard key={next.key} group={next} onChanged={refresh} />}

      {done.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowDone((v) => !v)} className="flex items-center gap-1 text-xs text-muted-foreground underline">
            {showDone ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {done.length} approved
          </button>
          {showDone && (
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {done.map((g) => (
                <li key={g.key} className="rounded-md border border-emerald-500/30 bg-background/60 px-2 py-1.5 text-xs">
                  <p className="font-medium">
                    <Check className="mr-1 inline h-3 w-3 text-emerald-700" />
                    {zoneListLabel(g.zones)} · {g.serviceLabel}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{g.text}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** One decision: a zone, or a run of zones that say the same thing. */
function GroupCard({ group, onChanged }: { group: ReviewGroup; onChanged: () => Promise<void> }) {
  const [pending, start] = useTransition();
  const [declining, setDeclining] = useState<ZoneReview | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const many = group.zones.length > 1;
  const pendingZones = group.zones.filter((z) => z.current?.status === "pending" && !z.changed);
  const waiting = group.zones.some((z) => !z.current || z.changed || z.current.status === "declined" || z.current.status === "superseded");
  const history = group.zones.flatMap((z) => z.history);

  function approveAll() {
    setError(null);
    start(async () => {
      const results = await Promise.all(pendingZones.map((z) => approveScopeRecommendation(z.current!.id)));
      const failed = results.find((r) => !r.ok);
      if (failed && !failed.ok) setError(failed.message);
      await onChanged();
    });
  }

  function decline() {
    if (!declining?.current) return;
    setError(null);
    const target = declining.current.id;
    start(async () => {
      const result = await declineScopeRecommendation(target, reason);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDeclining(null);
      setReason("");
      if (!result.value.next) setError("Declined, but a new recommendation could not be written. Try again in a moment.");
      await onChanged();
    });
  }

  return (
    <div className="rounded-md border border-border bg-background/70 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{zoneListLabel(group.zones)}</p>
          <p className="text-xs text-muted-foreground">
            {group.serviceLabel}
            {many ? ` · ${group.zones.length} zones, same service and same wording, one decision` : ""}
          </p>
        </div>
        <span className="text-xs font-medium text-amber-800">Needs a decision</span>
      </div>

      {/* The evaluator's words, per zone, as written. */}
      <div className="mt-2 flex flex-col gap-1">
        {group.zones.map((z) => (
          <div key={z.zoneIndex} className="rounded bg-muted/40 px-2 py-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {many ? `${z.zoneName} · ` : ""}Evaluator&apos;s note, as written
            </p>
            <p className="whitespace-pre-wrap text-sm">
              {z.note || <span className="text-muted-foreground">No note. The service&apos;s standard wording is recommended.</span>}
            </p>
          </div>
        ))}
      </div>

      {waiting ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {group.zones[0].changedWhy ? `${group.zones[0].changedWhy[0].toUpperCase()}${group.zones[0].changedWhy.slice(1)}; a fresh recommendation is being written.` : "A recommendation is being written."}
        </p>
      ) : (
        <div className="mt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Recommended scope of work{group.zones[0].current && group.zones[0].current.round > 1 ? `, round ${group.zones[0].current.round}` : ""}
          </p>
          <p className="whitespace-pre-wrap text-sm">{group.text}</p>
        </div>
      )}

      {!waiting && !declining && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={pending || pendingZones.length === 0} onClick={approveAll}>
            {pending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
            {many ? `Approve all ${group.zones.length}` : "Approve"}
          </Button>
          {many ? (
            <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              Decline just
              {pendingZones.map((z) => (
                <button key={z.zoneIndex} type="button" disabled={pending} onClick={() => setDeclining(z)} className="rounded border border-border px-1.5 py-0.5 hover:bg-accent">
                  {z.zoneName}
                </button>
              ))}
            </span>
          ) : (
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setDeclining(group.zones[0])}>
              <X className="mr-1 h-3.5 w-3.5" />
              Decline
            </Button>
          )}
        </div>
      )}

      {declining && (
        <div className="mt-2 flex flex-col gap-2 rounded border border-border p-2">
          <p className="text-xs font-medium">
            Declining {declining.zoneName}
            {many ? ". The other zones in this group stay as they are." : ""}
          </p>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why? Say what to change, or type the wording you want and it will be used exactly."
            className="min-h-[64px] text-sm"
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={pending || reason.trim().length < 3} onClick={decline}>
              {pending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1 h-3.5 w-3.5" />}
              Send back for a new one
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setDeclining(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}

      {history.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="flex items-center gap-1 text-xs text-muted-foreground underline">
            {showHistory ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {history.length} earlier round{history.length === 1 ? "" : "s"}
          </button>
          {showHistory && (
            <ul className="mt-1 flex flex-col gap-1.5">
              {history.map((h) => (
                <li key={h.id} className="rounded border border-border/60 px-2 py-1.5 text-xs">
                  <p className="text-muted-foreground">
                    {many ? `${h.zoneName} · ` : ""}Round {h.round} · {h.status}
                    {h.declineReason ? ` · declined: ${h.declineReason}` : ""}
                  </p>
                  <p className="whitespace-pre-wrap">{h.recommendedText}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
