"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Download, ExternalLink, Loader2, Mail, MapPin, Megaphone, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { addMarketingPlayDoors, approveMarketingPlay, approveMarketingPlays, editMarketingPlay, makeFlyerMailing, setMarketingPlayStatus } from "@/lib/actions/marketing-actions";
import { RouteHousePicker } from "@/components/marketing/route-house-picker";
import type { ZoneHouse } from "@/app/api/marketing/[playId]/zone-houses/route";
import { describePlayTrust, type PlayReview } from "@/lib/marketing-approval";
import {
  describePlays,
  flyerRoutesOf,
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
 * The marketing to do, one house at a time, approved and then ticked off.
 *
 * Nobody adds to this list. Every evaluation puts its door hangers here and
 * every new client puts the full set here, with the doors and the routes
 * already chosen. A person approves each play before it is done, or edits
 * it first: takes out the doors that are wrong, sets how many. The app
 * learns from that, and once ten of a kind have gone through untouched it
 * approves that kind itself. For the hangers, the tick is also the record:
 * a hanger on every door in the play.
 */

interface Door {
  id: string;
  address: string;
  lat: number;
  lng: number;
  distM: number;
}

export function MarketingTodo({
  plays,
  reviews = [],
  autoApproved = 0,
  onFocusZone,
  onFlyTo,
  onShowDoors,
}: {
  plays: MarketingPlay[];
  /** The decisions so far, for saying how much the app still asks. */
  reviews?: PlayReview[];
  autoApproved?: number;
  /** On the map page: show the zone and its walk. Elsewhere the row links to the map. */
  onFocusZone?: (zoneId: string) => void;
  onFlyTo?: (target: { lat: number; lng: number }) => void;
  /** On the map page: light up a play's doors. */
  onShowDoors?: (playId: string | null) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const [showDone, setShowDone] = useState(false);
  // What was just ticked or approved, before the page has caught up.
  const [local, setLocal] = useState<Record<string, Partial<MarketingPlay>>>({});
  // The play being edited, with its doors.
  const [editing, setEditing] = useState<{ id: string; doors: Door[]; routes: { id: string; zip: string; routeId: string; pieces: number }[]; remove: Set<string>; add: Set<string>; zoneHouses: ZoneHouse[]; quantity: number; note: string; loading: boolean } | null>(null);

  const merged = plays.map((p) => ({ ...p, ...(local[p.id] ?? {}) }));
  const summary = summarizePlays(merged);
  const groups = groupPlays(merged);
  const visible = showDone ? groups : groups.filter((g) => g.open > 0);
  const hidden = groups.length - visible.length;
  const waiting = merged.filter((p) => p.status === "open" && p.approval === "pending").length;

  function patch(id: string, value: Partial<MarketingPlay>) {
    setLocal((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...value } }));
  }

  function run(id: string, work: () => Promise<{ ok: true } | { ok: false; error: string }>, optimistic: Partial<MarketingPlay>, revert: Partial<MarketingPlay>) {
    setError(null);
    setBusy(id);
    patch(id, optimistic);
    startTransition(async () => {
      const result = await work();
      setBusy(null);
      if (!result.ok) {
        patch(id, revert);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function set(play: MarketingPlay, status: PlayStatus) {
    run(play.id, () => setMarketingPlayStatus(play.id, status), { status }, { status: play.status });
  }

  function approve(play: MarketingPlay) {
    run(play.id, () => approveMarketingPlay(play.id), { approval: "approved" }, { approval: play.approval });
  }

  async function startEdit(play: MarketingPlay) {
    setError(null);
    setEditing({ id: play.id, doors: [], routes: [], remove: new Set(), add: new Set(), zoneHouses: [], quantity: play.quantity, note: "", loading: true });
    onShowDoors?.(play.id);
    try {
      const res = await fetch(`/api/marketing/${play.id}/doors`, { cache: "no-store" });
      const body = (await res.json()) as { doors?: Door[]; routes?: { id: string; zip: string; routeId: string; pieces: number }[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not load the doors.");
      setEditing((e) => (e && e.id === play.id ? { ...e, doors: body.doors ?? [], routes: body.routes ?? flyerRoutesOf(play), loading: false } : e));

      // The whole zone, so houses that are not on the round can be tapped on
      // to it. Fetched after the doors and allowed to fail on its own: the
      // list still works without a map.
      if (play.kind === "door_hangers" || play.kind === "knocks") {
        try {
          const zoneRes = await fetch(`/api/marketing/${play.id}/zone-houses`, { cache: "no-store" });
          const zoneBody = (await zoneRes.json()) as { houses?: ZoneHouse[] };
          setEditing((e) => (e && e.id === play.id ? { ...e, zoneHouses: zoneBody.houses ?? [] } : e));
        } catch {
          // No map, just the list.
        }
      }
    } catch (err) {
      setEditing(null);
      setError(err instanceof Error ? err.message : "Could not load the doors.");
    }
  }

  function saveEdit(play: MarketingPlay) {
    if (!editing) return;
    const remove = [...editing.remove];
    const add = [...editing.add];
    const quantity = play.kind === "door_hangers" || play.kind === "knocks" ? editing.quantity : null;
    setError(null);
    setBusy(play.id);
    startTransition(async () => {
      // Additions first. Removing re-approves the round as its last act, so
      // doing it the other way round would leave the added doors sitting on a
      // round that had just been sent back to pending.
      if (add.length > 0) {
        const added = await addMarketingPlayDoors(play.id, add);
        if (!added.ok) {
          setBusy(null);
          setError(added.error);
          return;
        }
      }
      const result = await editMarketingPlay({ playId: play.id, remove, quantity, note: editing.note, approve: true });
      setBusy(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      patch(play.id, { approval: "approved", quantity: result.value.quantity });
      setEditing(null);
      onShowDoors?.(null);
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
        <p className="mt-1 text-xs text-muted-foreground">
          {describePlays(summary)}
          {waiting > 0 ? ` ${waiting} waiting for your approval.` : ""}
          {autoApproved > 0 ? ` The app approved ${autoApproved} just now because they look like ones you approved.` : ""}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Every evaluation: {RECIPE.evaluation}. Every new client: {RECIPE.client}. Added on their own; approve each, or edit it first, then tick it off when it is out.
        </p>
        {reviews.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">{describePlayTrust(reviews)}</p>}
      </div>
      {waiting > 1 && (
        <div className="rounded-lg border border-border/60 bg-background/60 p-2.5">
          <p className="text-xs">
            <span className="font-medium">{waiting} waiting for your approval.</span>{" "}
            <span className="text-muted-foreground">
              Nothing goes out until you say so. Read the list below, and if the set looks right, approve it in one go rather than one at a time — after ten of a kind go through untouched the app approves that kind itself.
            </span>
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-1.5 h-7"
            disabled={bulk}
            onClick={() => {
              setError(null);
              setBulk(true);
              startTransition(async () => {
                const result = await approveMarketingPlays(plays.filter((p) => p.status === "open" && p.approval === "pending").map((p) => p.id));
                setBulk(false);
                if (!result.ok) setError(result.error);
                else router.refresh();
              });
            }}
          >
            {bulk ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />} Approve all {waiting}
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {visible.length === 0 && !showDone && summary.done > 0 && <p className="text-xs text-muted-foreground">Nothing left to do.</p>}

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
              <span className={group.reason === "client" ? "shrink-0 rounded bg-emerald-600/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700" : group.reason === "ramp" ? "shrink-0 rounded bg-amber-600/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700" : "shrink-0 rounded bg-sky-600/15 px-1.5 py-0.5 text-[11px] font-medium text-sky-700"}>
                {REASON_LABEL[group.reason]}
              </span>
            </div>
            <ul className="mt-2 space-y-1.5">
              {group.plays.map((play) => {
                const done = play.status === "done";
                const skipped = play.status === "skipped";
                const pending = play.approval === "pending" && !done && !skipped;
                const working = busy === play.id && isPending;
                const isEditing = editing?.id === play.id;
                return (
                  <li key={play.id} className="flex items-start gap-2 text-xs">
                    <Checkbox
                      checked={done}
                      disabled={working || skipped || pending}
                      onCheckedChange={(checked) => set(play, checked === true ? "done" : "open")}
                      className="mt-0.5 h-5 w-5"
                      aria-label={`${KIND_LABEL[play.kind]} done`}
                      title={pending ? "Approve it first" : undefined}
                    />
                    <div className="min-w-0 flex-1">
                      <p className={`font-medium ${done || skipped ? "text-muted-foreground line-through" : ""}`}>
                        {playTitle(play)}
                        {pending && <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-0.5 text-[10px] font-medium text-amber-700">needs approval</span>}
                        {play.approval === "auto" && !done && <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground" title="Approved by the app, because it looks like ones you approved">approved by the app</span>}
                        {(play.removedCount ?? 0) > 0 && <span className="ml-1.5 text-[10px] text-muted-foreground">{play.removedCount} taken out</span>}
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

                      {isEditing && editing && (
                        <div className="mt-1.5 space-y-1.5 rounded-md border border-border bg-background p-2">
                          {editing.loading ? (
                            <p className="text-muted-foreground"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Loading the doors…</p>
                          ) : (
                            <>
                              {(play.kind === "door_hangers" || play.kind === "knocks") && (
                                <label className="flex items-center gap-2">
                                  <span>How many doors</span>
                                  <input
                                    type="number"
                                    min={1}
                                    max={2000}
                                    value={editing.quantity}
                                    onChange={(e) => setEditing((x) => (x ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x))}
                                    className="h-7 w-20 rounded-md border border-border bg-background px-2"
                                  />
                                  {play.kind === "door_hangers" && <span className="text-muted-foreground">nearest the house, never one you take out</span>}
                                </label>
                              )}
                              {/* The map, above the list. Tapping a hollow house
                                  puts it on the round; tapping a filled one
                                  takes it off — the same two edits the list
                                  makes, on the thing they are actually about. */}
                              {editing.zoneHouses.length > 0 && (
                                <RouteHousePicker
                                  houses={editing.zoneHouses}
                                  on={
                                    new Set(
                                      editing.zoneHouses
                                        .filter((h) => (h.on && !editing.remove.has(h.id)) || editing.add.has(h.id))
                                        .map((h) => h.id)
                                    )
                                  }
                                  onToggle={(houseId) =>
                                    setEditing((x) => {
                                      if (!x) return x;
                                      const house = x.zoneHouses.find((h) => h.id === houseId);
                                      if (!house) return x;
                                      const remove = new Set(x.remove);
                                      const add = new Set(x.add);
                                      // On the round means either it started
                                      // there and has not been removed, or it
                                      // has been added since.
                                      const currentlyOn = (house.on && !remove.has(houseId)) || add.has(houseId);
                                      if (currentlyOn) {
                                        add.delete(houseId);
                                        if (house.on) remove.add(houseId);
                                      } else {
                                        remove.delete(houseId);
                                        if (!house.on) add.add(houseId);
                                      }
                                      return { ...x, remove, add };
                                    })
                                  }
                                />
                              )}
                              {editing.add.size > 0 && (
                                <p className="text-[11px] text-primary">
                                  {editing.add.size} door{editing.add.size === 1 ? "" : "s"} added
                                </p>
                              )}
                              {editing.doors.length > 0 && (
                                <div className="max-h-56 overflow-y-auto rounded border border-border/60">
                                  {editing.doors.map((d, i) => {
                                    const out = editing.remove.has(d.id);
                                    return (
                                      <label key={d.id} className={`flex items-center gap-2 px-2 py-0.5 ${out ? "text-muted-foreground line-through" : ""} ${i % 2 ? "bg-muted/30" : ""}`}>
                                        <input
                                          type="checkbox"
                                          checked={!out}
                                          onChange={() =>
                                            setEditing((x) => {
                                              if (!x) return x;
                                              const remove = new Set(x.remove);
                                              if (remove.has(d.id)) remove.delete(d.id);
                                              else remove.add(d.id);
                                              return { ...x, remove };
                                            })
                                          }
                                          className="h-3.5 w-3.5"
                                        />
                                        <span className="w-6 shrink-0 tabular-nums text-muted-foreground">{i + 1}</span>
                                        <span className="truncate">{shortAddress(d.address)}</span>
                                        <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{Math.round(d.distM)} m</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                              {play.kind === "flyers" && editing.routes.length > 0 && (
                                <div className="rounded border border-border/60">
                                  {editing.routes.map((r) => {
                                    const out = editing.remove.has(r.id);
                                    return (
                                      <label key={r.id} className={`flex items-center gap-2 px-2 py-0.5 ${out ? "text-muted-foreground line-through" : ""}`}>
                                        <input
                                          type="checkbox"
                                          checked={!out}
                                          onChange={() =>
                                            setEditing((x) => {
                                              if (!x) return x;
                                              const remove = new Set(x.remove);
                                              if (remove.has(r.id)) remove.delete(r.id);
                                              else remove.add(r.id);
                                              return { ...x, remove };
                                            })
                                          }
                                          className="h-3.5 w-3.5"
                                        />
                                        <span>USPS {r.zip} {r.routeId}</span>
                                        <span className="ml-auto tabular-nums text-muted-foreground">{Number(r.pieces).toLocaleString()} pieces</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                              <input
                                value={editing.note}
                                onChange={(e) => setEditing((x) => (x ? { ...x, note: e.target.value } : x))}
                                placeholder="Why, in a few words (optional)"
                                className="h-7 w-full rounded-md border border-border bg-background px-2"
                              />
                              <div className="flex gap-2">
                                <Button type="button" size="sm" className="h-7" disabled={working} onClick={() => saveEdit(play)}>
                                  {working ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />} Save and approve
                                </Button>
                                <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => { setEditing(null); onShowDoors?.(null); }}>
                                  Cancel
                                </Button>
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {!done && !skipped && !isEditing && (
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                          {pending && (
                            <button type="button" disabled={working} className="inline-flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 font-medium text-primary-foreground" onClick={() => approve(play)}>
                              <Check className="h-3 w-3" /> Approve
                            </button>
                          )}
                          {play.kind !== "yard_sign" && (
                            <button type="button" disabled={working} className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => void startEdit(play)}>
                              <Pencil className="h-3 w-3" /> {pending ? "Edit" : "Edit again"}
                            </button>
                          )}
                          {(play.kind === "door_hangers" || play.kind === "knocks") && play.quantity > 0 && (
                            <a href={`/api/marketing/${play.id}/door-list`} className="inline-flex items-center gap-1 text-primary hover:underline">
                              <Download className="h-3 w-3" /> Door list
                            </a>
                          )}
                          {(play.kind === "door_hangers" || play.kind === "knocks") && onShowDoors && (
                            <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => onShowDoors(play.id)}>
                              <MapPin className="h-3 w-3" /> Show doors
                            </button>
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
                          {play.kind !== "door_hangers" && play.kind !== "knocks" && onFlyTo && (
                            <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => onFlyTo({ lat: play.lat, lng: play.lng })}>
                              <MapPin className="h-3 w-3" /> Show
                            </button>
                          )}
                          {play.kind === "flyers" && play.quantity > 0 && !pending && (
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
