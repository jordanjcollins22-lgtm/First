"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, Loader2, Mail, MapPin, Megaphone } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { makeFlyerMailing, setMarketingPlayStatus } from "@/lib/actions/marketing-actions";
import {
  describePlays,
  groupPlays,
  KIND_LABEL,
  playDetail,
  playTitle,
  REASON_LABEL,
  RECIPE,
  shortAddress,
  summarizePlays,
  type MarketingPlay,
  type PlayStatus,
} from "@/lib/marketing-plays";

/**
 * The marketing to do, one house at a time, ticked off as it goes out.
 *
 * Nobody adds to this list. Every evaluation puts its door hangers here and
 * every new client puts the full set here, with the doors and the routes
 * already chosen. What is left for a person is the tick, and for the
 * hangers the tick is also the record: a hanger on every door in the play.
 */
export function MarketingTodo({
  plays,
  onFocusZone,
  onFlyTo,
}: {
  plays: MarketingPlay[];
  /** On the map page: show the zone and its walk. Elsewhere the row links to the map. */
  onFocusZone?: (zoneId: string) => void;
  onFlyTo?: (target: { lat: number; lng: number }) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  // What was just ticked, before the page has caught up.
  const [local, setLocal] = useState<Record<string, PlayStatus>>({});

  const statusOf = (play: MarketingPlay): PlayStatus => local[play.id] ?? play.status;
  const merged = plays.map((p) => ({ ...p, status: statusOf(p) }));
  const summary = summarizePlays(merged);
  const groups = groupPlays(merged);
  const visible = showDone ? groups : groups.filter((g) => g.open > 0);
  const hidden = groups.length - visible.length;

  function set(play: MarketingPlay, status: PlayStatus) {
    setError(null);
    setBusy(play.id);
    setLocal((prev) => ({ ...prev, [play.id]: status }));
    startTransition(async () => {
      const result = await setMarketingPlayStatus(play.id, status);
      setBusy(null);
      if (!result.ok) {
        setLocal((prev) => ({ ...prev, [play.id]: play.status }));
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function mail(play: MarketingPlay) {
    setError(null);
    setBusy(play.id);
    startTransition(async () => {
      const result = await makeFlyerMailing(play.id);
      setBusy(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      window.open(`/eddm/mailings/${result.value.mailingId}/order`, "_blank", "noopener");
      router.refresh();
    });
  }

  return (
    <section className="space-y-3">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Megaphone className="h-4 w-4" /> Marketing to do
          <span className="ml-auto text-xs font-normal tabular-nums text-muted-foreground">{summary.open}</span>
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">{describePlays(summary)}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Every evaluation: {RECIPE.evaluation}. Every new client: {RECIPE.client}. Added on their own; tick each off when it is out.
        </p>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {visible.length === 0 && !showDone && summary.done > 0 && (
        <p className="text-xs text-muted-foreground">Nothing left to do.</p>
      )}

      <ul className="space-y-2">
        {visible.map((group) => (
          <li key={group.houseId} className={`rounded-lg border p-2.5 ${group.open > 0 ? "border-border bg-background/60" : "border-border/60 opacity-70"}`}>
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                {group.jobId ? (
                  <Link href={`/jobs/${group.jobId}`} className="truncate text-sm font-medium hover:underline">
                    {group.customerName ?? shortAddress(group.address)}
                  </Link>
                ) : (
                  <span className="truncate text-sm font-medium">{group.customerName ?? shortAddress(group.address)}</span>
                )}
                <p className="truncate text-xs text-muted-foreground">{shortAddress(group.address)}</p>
              </div>
              <span
                className={
                  group.reason === "client"
                    ? "shrink-0 rounded bg-emerald-600/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700"
                    : "shrink-0 rounded bg-sky-600/15 px-1.5 py-0.5 text-[11px] font-medium text-sky-700"
                }
              >
                {REASON_LABEL[group.reason]}
              </span>
            </div>
            <ul className="mt-2 space-y-1.5">
              {group.plays.map((play) => {
                const done = play.status === "done";
                const skipped = play.status === "skipped";
                const working = busy === play.id && isPending;
                return (
                  <li key={play.id} className="flex items-start gap-2 text-xs">
                    <Checkbox
                      checked={done}
                      disabled={working || skipped}
                      onCheckedChange={(checked) => set(play, checked === true ? "done" : "open")}
                      className="mt-0.5 h-5 w-5"
                      aria-label={`${KIND_LABEL[play.kind]} done`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className={`font-medium ${done || skipped ? "text-muted-foreground line-through" : ""}`}>
                        {playTitle(play)}
                        {working && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
                      </p>
                      <p className="text-muted-foreground">{playDetail(play)}</p>
                      {done && play.doneAt && (
                        <p className="text-[11px] text-muted-foreground">
                          Done {new Date(play.doneAt).toLocaleDateString()}
                          {play.doneBy ? ` by ${play.doneBy}` : ""}
                        </p>
                      )}
                      {skipped && (
                        <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => set(play, "open")}>
                          Skipped. Put it back
                        </button>
                      )}
                      {!done && !skipped && (
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                          {(play.kind === "door_hangers" || play.kind === "knocks") && play.quantity > 0 && (
                            <a href={`/api/marketing/${play.id}/door-list`} className="inline-flex items-center gap-1 text-primary hover:underline">
                              <Download className="h-3 w-3" /> Door list
                            </a>
                          )}
                          {play.kind === "door_hangers" && play.zoneId && (
                            onFocusZone ? (
                              <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => onFocusZone(play.zoneId!)}>
                                <MapPin className="h-3 w-3" /> Walk
                              </button>
                            ) : (
                              <Link href={`/attractors?zone=${play.zoneId}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                                <MapPin className="h-3 w-3" /> Walk
                              </Link>
                            )
                          )}
                          {play.kind !== "door_hangers" && onFlyTo && (
                            <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => onFlyTo({ lat: play.lat, lng: play.lng })}>
                              <MapPin className="h-3 w-3" /> Show
                            </button>
                          )}
                          {play.kind === "flyers" && play.quantity > 0 && (
                            play.mailingId ? (
                              <a href={`/eddm/mailings/${play.mailingId}/order`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                                <ExternalLink className="h-3 w-3" /> Order package
                              </a>
                            ) : (
                              <button type="button" disabled={working} className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => mail(play)}>
                                <Mail className="h-3 w-3" /> Make the mailing
                              </button>
                            )
                          )}
                          <button type="button" className="text-muted-foreground hover:underline" onClick={() => set(play, "skipped")}>
                            Skip
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>

      {(hidden > 0 || showDone) && groups.length > 0 && (
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowDone((v) => !v)}>
          {showDone ? "Hide what is done" : `Show what is done (${hidden})`}
        </button>
      )}
    </section>
  );
}
