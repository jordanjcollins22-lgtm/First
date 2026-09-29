"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImageCanvasBoard, type BoardControl } from "@/components/canvas/image-canvas-board";
import type { WorkZone } from "@/components/canvas/types";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import type { CanvasDesignRow, EvaluationStatus } from "@/types/domain";
import { sendOrKeep } from "@/lib/offline/outbox-send";
import { PHOTO_AREAS } from "@/lib/evaluation-intake";
import {
  addedItem,
  areaLabel,
  isSeededZone,
  markReviewed,
  putBack,
  removeFromPlan,
  stillToReview,
  walkPlan,
  zoneSeeds,
  type PlanItem,
} from "@/lib/evaluation-visit";
import type { LotData } from "@/lib/lot-map";
import { cn } from "@/lib/utils";

/**
 * The walkthrough, on one page: the property with every area on it, the
 * list of areas, and Submit evaluation at the bottom.
 *
 * Everything the client asked for on their pre-eval is already there: they
 * filled out the form for it, so nothing waits on a yes. Each area has one
 * button, Review, which goes through its questions one at a time. Some are
 * read out to the client, some are the evaluator's to check, and anything
 * already on their form is read back to confirm. An area can be removed
 * from any of its questions.
 *
 * Add an area stays on screen while the evaluator walks the property, and
 * settles above Submit evaluation at the end of the page. Submit waits until
 * every area has been reviewed, then hands the site map to the account
 * manager to price. Nothing goes to the client.
 */
export function SiteMapSetup({
  jobId,
  initialPlan,
  services,
  catalog,
  design,
  address,
  lat,
  lng,
  evaluationStatus,
  evaluatorName,
  preview = false,
  demoLot = null,
}: {
  jobId: string;
  initialPlan: PlanItem[];
  services: { typeId: string; name: string }[];
  catalog: CanvasCatalog;
  design: CanvasDesignRow | null;
  address: string;
  lat: number | null;
  lng: number | null;
  evaluationStatus: EvaluationStatus;
  evaluatorName: string | null;
  /** For the owner's walk-through: nothing is saved and the map is the practice one. */
  preview?: boolean;
  demoLot?: LotData | null;
}) {
  const [plan, setPlan] = useState<PlanItem[]>(() => walkPlan(initialPlan));
  const planRef = useRef(plan);
  const [zones, setZones] = useState<WorkZone[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const board = useRef<BoardControl | null>(null);
  const router = useRouter();
  const [done, setDone] = useState(evaluationStatus === "completed");
  const [sending, setSending] = useState(false);
  const [sendNote, setSendNote] = useState<string | null>(null);

  /** Changes the plan and keeps it: on the server, or on the phone with no signal. */
  const update = useCallback(
    (change: (items: PlanItem[]) => PlanItem[]) => {
      const next = change(planRef.current);
      planRef.current = next;
      setPlan(next);
      setError(null);
      if (preview) return;
      start(async () => {
        const sent = await sendOrKeep({
          id: `visit-plan:${jobId}`,
          kind: "visit-plan",
          scope: `site-map:${jobId}`,
          label: "The areas you've reviewed",
          blob: null,
          type: "",
          args: { jobId, items: next },
        });
        if (sent.status === "refused") setError(sent.message);
      });
    },
    [jobId, preview]
  );

  const seeds = useMemo(() => zoneSeeds(plan), [plan]);
  const areas = plan.filter((i) => i.keep !== false);
  const removed = plan.filter((i) => i.keep === false);
  const waiting = stillToReview(plan);
  // Drawn by hand before the walkthrough existed: still on the map, still priced.
  const drawn = zones.filter((z) => !isSeededZone(z.id));
  const zoneById = new Map(zones.map((z) => [z.id, z]));

  // The same number on the map and in the list.
  const badges = useMemo(() => {
    const out: Record<string, number> = {};
    const listed = plan.filter((i) => i.keep !== false);
    listed.forEach((item, n) => (out[item.id] = n + 1));
    zones.filter((z) => !isSeededZone(z.id)).forEach((zone, n) => (out[zone.id] = listed.length + n + 1));
    return out;
  }, [plan, zones]);

  const walkthrough = useMemo(
    () => ({
      badges,
      formFor: (zoneId: string) => {
        const item = planRef.current.find((i) => i.id === zoneId);
        // A zone drawn by hand was set up in full before: its summary, not its questions.
        return { fromForm: item?.fromForm ?? [], reviewed: item ? Boolean(item.reviewed) : true };
      },
      onReviewed: (zoneId: string) => {
        if (planRef.current.some((i) => i.id === zoneId)) update((items) => markReviewed(items, zoneId));
      },
      onZones: setZones,
    }),
    [badges, update]
  );

  function review(item: PlanItem) {
    // Taken off earlier and wanted after all: back on the map, questions from the start.
    if (item.keep === false) update((items) => putBack(items, item.id));
    board.current?.openZone(item.id);
  }

  function add(area: string, typeId: string, name: string) {
    const item = addedItem(area, typeId, name, crypto.randomUUID().slice(0, 8));
    update((items) => [...items, item]);
    setAdding(false);
    // Straight into its questions once it is on the map.
    board.current?.openZone(item.id);
  }

  // The map is saved and submitted; the proposal waits for the account
  // manager to price and approve it, and nothing goes to the client yet.
  async function submit() {
    setSendNote(null);
    if (preview) {
      setSendNote("Preview: this saves the site map and sends it to the account manager.");
      return;
    }
    // Handing it over needs the server; the map itself is already kept on the phone.
    const noSignal = "No signal. Everything is saved on this phone. Tap Submit evaluation again when you have signal.";
    if (!navigator.onLine) {
      setSendNote(noSignal);
      return;
    }
    setSending(true);
    const ok = await (board.current?.submit() ?? Promise.resolve(false));
    setSending(false);
    if (ok) {
      setDone(true);
      router.refresh();
    } else {
      setSendNote(navigator.onLine ? "It didn't go through. Try again in a moment." : noSignal);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <ImageCanvasBoard
        catalog={catalog}
        jobId={preview ? undefined : jobId}
        practice={preview}
        demoLot={demoLot}
        initialDesign={design}
        initialAddress={address}
        initialLat={lat ?? undefined}
        initialLng={lng ?? undefined}
        initialEvaluationStatus={evaluationStatus}
        evaluatorName={evaluatorName}
        seedZones={seeds}
        onSeedRemoved={(id) => update((items) => removeFromPlan(items, id))}
        controlRef={board}
        walkthrough={walkthrough}
      />

      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Their areas</h2>
        <span className="text-xs text-muted-foreground">{waiting.length === 0 && areas.length > 0 ? "All reviewed" : "From their pre-eval"}</span>
      </div>

      {areas.length === 0 && drawn.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          Nothing on the site map yet. Tap Add an area for each thing they want done.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {areas.map((item) => (
          <AreaRow
            key={item.id}
            number={badges[item.id]}
            color={zoneById.get(item.id)?.color}
            title={item.label}
            where={areaLabel(item.area)}
            detail={[areaLabel(item.area), item.added ? "Added on site" : null, item.reviewed ? summary(zoneById.get(item.id)) : null]}
            reviewed={Boolean(item.reviewed)}
            onReview={() => review(item)}
          />
        ))}
        {drawn.map((zone) => (
          <AreaRow
            key={zone.id}
            number={badges[zone.id]}
            color={zone.color}
            title={zone.name}
            detail={["Drawn on the map", summary(zone)]}
            reviewed
            onReview={() => board.current?.openZone(zone.id)}
          />
        ))}
        {removed.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2">
            <p className="min-w-0 text-sm text-muted-foreground">
              <span className="block truncate line-through">{item.label}</span>
              <span className="text-xs">{areaLabel(item.area)} · Removed</span>
            </p>
            <ReviewButton quiet onClick={() => review(item)} label={`Review ${item.label}, ${areaLabel(item.area)}`} />
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Rides the bottom of the screen while they walk the property, and
          settles here, above Submit, at the end of the page. */}
      <div className="sticky bottom-3 z-20">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 text-base font-semibold text-white shadow-lg hover:bg-violet-700"
        >
          <Plus className="h-5 w-5" /> Add an area
        </button>
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
        {done && (
          <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> Submitted. The site map is with the account manager.
          </p>
        )}
        {waiting.length > 0 && (
          <p className="text-center text-sm font-medium text-amber-800 dark:text-amber-300">
            {waiting.length === 1 ? "1 area still to review." : `${waiting.length} areas still to review.`}
          </p>
        )}
        <Button
          type="button"
          className="h-14 text-base font-semibold"
          disabled={sending || waiting.length > 0 || areas.length + drawn.length === 0}
          onClick={submit}
        >
          {sending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
          {done ? "Send the changes to the account manager" : "Submit evaluation"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">Goes to the account manager to price. Nothing goes to the client yet.</p>
        {sendNote && <p className="text-center text-sm text-muted-foreground">{sendNote}</p>}
      </div>

      <AddArea open={adding} services={services} onAdd={add} onClose={() => setAdding(false)} />
    </section>
  );
}

/** What was found, in a few words: its size and how many photos. */
function summary(zone: WorkZone | undefined): string | null {
  if (!zone) return null;
  const size =
    zone.areaSqFt != null && zone.widthFt != null
      ? `${Math.round(zone.areaSqFt).toLocaleString()} sq ft`
      : zone.lengthFt != null
        ? `${zone.lengthFt} ft`
        : zone.areaSqFt != null
          ? `${Math.round(zone.areaSqFt).toLocaleString()} sq ft`
          : null;
  const photos = zone.service?.photos?.length ?? 0;
  return [size, photos > 0 ? `${photos} ${photos === 1 ? "photo" : "photos"}` : null].filter(Boolean).join(" · ") || null;
}

function AreaRow({
  number,
  color,
  title,
  where,
  detail,
  reviewed,
  onReview,
}: {
  number: number | undefined;
  color: string | undefined;
  title: string;
  /** Which part of the yard, for telling two beds apart without looking. */
  where?: string;
  detail: (string | null)[];
  reviewed: boolean;
  onReview: () => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted-foreground text-xs font-bold text-white"
        style={color ? { background: color } : undefined}
      >
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-sm font-semibold">
          <span className="truncate">{title}</span>
          {reviewed && <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Reviewed" />}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {detail.filter(Boolean).join(" · ")}
          {!reviewed && <span className="font-semibold text-amber-700 dark:text-amber-400"> · Not reviewed yet</span>}
        </p>
      </div>
      <ReviewButton quiet={reviewed} onClick={onReview} label={where ? `Review ${title}, ${where}` : `Review ${title}`} />
    </li>
  );
}

function ReviewButton({ quiet, onClick, label }: { quiet: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex h-11 shrink-0 items-center gap-1 rounded-lg px-3 text-sm font-semibold",
        quiet ? "border border-border bg-background" : "bg-primary text-primary-foreground"
      )}
    >
      Review <ChevronRight className="h-4 w-4" />
    </button>
  );
}

/** A new area: where it is, then what is being done there. Its questions follow. */
function AddArea({
  open,
  services,
  onAdd,
  onClose,
}: {
  open: boolean;
  services: { typeId: string; name: string }[];
  onAdd: (area: string, typeId: string, name: string) => void;
  onClose: () => void;
}) {
  const [area, setArea] = useState<string | null>(null);
  const close = () => {
    setArea(null);
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{area ? "What's being done there?" : "Where is it?"}</DialogTitle>
          <DialogDescription>{area ? areaLabel(area) : "Tap one."}</DialogDescription>
        </DialogHeader>
        {!area ? (
          <div className="grid grid-cols-2 gap-2">
            {PHOTO_AREAS.map((a) => (
              <button
                key={a.value}
                type="button"
                onClick={() => setArea(a.value)}
                className="min-h-14 rounded-xl border-2 border-border bg-card px-3 text-base font-semibold hover:border-primary"
              >
                {a.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid max-h-[55vh] grid-cols-1 gap-2 overflow-y-auto">
              {services.map((s) => (
                <button
                  key={s.typeId}
                  type="button"
                  onClick={() => {
                    const where = area;
                    setArea(null);
                    onAdd(where, s.typeId, s.name);
                  }}
                  className="min-h-14 rounded-xl border-2 border-border bg-card px-3 text-left text-base font-semibold hover:border-primary"
                >
                  {s.name}
                </button>
              ))}
            </div>
            <Button type="button" variant="ghost" className="self-start" onClick={() => setArea(null)}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Somewhere else
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
