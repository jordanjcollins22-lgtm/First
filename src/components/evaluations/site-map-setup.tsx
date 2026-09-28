"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Loader2, Plus, Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ImageCanvasBoard } from "@/components/canvas/image-canvas-board";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import type { CanvasDesignRow, EvaluationStatus } from "@/types/domain";
import { saveVisitPlan } from "@/lib/actions/evaluation-visit-actions";
import { PHOTO_AREAS } from "@/lib/evaluation-intake";
import { addedItem, areaLabel, suggestionSeeds, zoneSeeds, type PlanItem } from "@/lib/evaluation-visit";
import type { LotData } from "@/lib/lot-map";
import { cn } from "@/lib/utils";

/**
 * The site map on site, with the client's pre-evaluation form laid over it
 * as suggestions. What they asked for shows dashed over the part of the
 * yard it is in, each with a tick and a cross; it is not on the site map
 * until the evaluator ticks it, and then its details open to fill in.
 *
 * Under the map, the same suggestions as a list, what is on the map with
 * Remove, what was crossed out with Put back, and Add for anything they did
 * not ask for. Drawing an area by hand works as always. Walkthrough
 * complete waits until every suggestion is ticked or crossed, then hands
 * the map to the account manager to price and send.
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
  const [plan, setPlan] = useState<PlanItem[]>(initialPlan);
  const [adding, setAdding] = useState(false);
  const [addArea, setAddArea] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const board = useRef<{ submit: () => Promise<boolean> } | null>(null);
  const router = useRouter();
  const [done, setDone] = useState(evaluationStatus === "completed");
  const [sending, setSending] = useState(false);
  const [sendNote, setSendNote] = useState<string | null>(null);

  // The map is saved and submitted; the proposal waits for the account
  // manager to price and approve it, and nothing goes to the client yet.
  async function completeWalkthrough() {
    setSendNote(null);
    if (preview) {
      setSendNote("Preview: this saves the map and sends it to the account manager.");
      return;
    }
    setSending(true);
    const ok = await (board.current?.submit() ?? Promise.resolve(false));
    setSending(false);
    if (ok) {
      setDone(true);
      router.refresh();
    } else {
      setSendNote("It didn't go through. Check the note on the map above and try again.");
    }
  }

  const seeds = useMemo(() => zoneSeeds(plan), [plan]);
  const suggested = useMemo(() => suggestionSeeds(plan), [plan]);
  const waiting = plan.filter((i) => i.keep === null);
  const onMap = plan.filter((i) => i.keep === true);
  const off = plan.filter((i) => i.keep === false);

  function save(next: PlanItem[]) {
    setPlan(next);
    setError(null);
    if (preview) return;
    start(async () => {
      const result = await saveVisitPlan(jobId, next);
      if (!result.ok) setError(result.message);
    });
  }

  const setKeep = (id: string, keep: boolean) => save(plan.map((i) => (i.id === id ? { ...i, keep } : i)));

  function add(typeId: string, name: string) {
    if (!addArea) return;
    save([...plan, addedItem(addArea, typeId, name, crypto.randomUUID().slice(0, 8))]);
    setAdding(false);
    setAddArea(null);
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">The site map</h2>
        <p className="text-sm text-muted-foreground">
          {waiting.length > 0
            ? "What they asked for on their pre-eval is on the map, dashed. Tap ✓ to add it to the site map and fill in the details, or ✗ if it isn't being done. Draw or add anything else they want."
            : "Tap each area to measure it and add photos. Draw or add anything else they want, then Walkthrough complete."}
        </p>
      </div>

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
        onSeedRemoved={(id) => setKeep(id, false)}
        suggestions={suggested}
        onSuggestion={(id, accept) => setKeep(id, accept)}
        controlRef={board}
      />

      {waiting.length > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl border border-amber-500/50 bg-amber-50/60 p-4">
          <p className="text-sm font-semibold">From their pre-eval, still to decide ({waiting.length})</p>
          {waiting.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-background/80 p-3">
              <p className="min-w-0 text-sm">
                <span className="font-medium">{item.label}</span>
                <span className="block text-xs text-muted-foreground">{areaLabel(item.area)}</span>
              </p>
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  aria-label={`Add ${item.label} to the site map`}
                  onClick={() => setKeep(item.id, true)}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600 text-white"
                >
                  <Check className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  aria-label={`Not doing ${item.label}`}
                  onClick={() => setKeep(item.id, false)}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold">On the site map ({onMap.length})</p>
        {onMap.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet. Tick what they asked for, draw an area, or add one below.</p>}
        {onMap.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
            <div className="min-w-0">
              <p className="font-medium">{item.label}</p>
              <p className="text-xs text-muted-foreground">
                {areaLabel(item.area)} · {item.added ? "Added on site" : "From their pre-eval"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setKeep(item.id, false)}
              className="flex h-10 shrink-0 items-center gap-1 rounded-lg border border-border px-3 text-sm font-semibold"
            >
              <X className="h-4 w-4" /> Remove
            </button>
          </div>
        ))}

        {off.length > 0 && (
          <>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Not doing</p>
            {off.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-3">
                <p className="min-w-0 text-sm text-muted-foreground line-through">
                  {areaLabel(item.area)} · {item.label}
                </p>
                <button
                  type="button"
                  onClick={() => setKeep(item.id, true)}
                  className="flex h-10 shrink-0 items-center gap-1 rounded-lg border border-border px-3 text-sm font-semibold"
                >
                  <Undo2 className="h-4 w-4" /> Put back
                </button>
              </div>
            ))}
          </>
        )}

        {!adding ? (
          <Button type="button" variant="outline" className="mt-1 h-12" onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Add something they didn&apos;t ask for
          </Button>
        ) : (
          <div className="mt-1 flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3">
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-semibold">Where?</p>
              <div className="flex flex-wrap gap-1.5">
                {PHOTO_AREAS.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    aria-pressed={addArea === a.value}
                    onClick={() => setAddArea(a.value)}
                    className={cn(
                      "min-h-11 rounded-full border px-4 text-sm",
                      addArea === a.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"
                    )}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
            {addArea && (
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-semibold">What?</p>
                <div className="flex flex-wrap gap-1.5">
                  {services.map((s) => (
                    <button
                      key={s.typeId}
                      type="button"
                      onClick={() => add(s.typeId, s.name)}
                      className="min-h-11 rounded-full border border-border bg-background px-4 text-sm hover:border-primary"
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button
              type="button"
              className="self-start text-sm text-muted-foreground underline"
              onClick={() => {
                setAdding(false);
                setAddArea(null);
              }}
            >
              Cancel
            </button>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {/* The end of the visit. */}
      <div className="flex flex-col gap-2 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
        {done && (
          <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Walkthrough complete. The site map is with the account manager.
          </p>
        )}
        {waiting.length > 0 && (
          <p className="text-center text-sm font-medium text-amber-800">
            Tick or cross {waiting.length === 1 ? "the last thing" : `the ${waiting.length} things`} from their pre-eval first.
          </p>
        )}
        <Button type="button" className="h-14 text-base font-semibold" disabled={sending || waiting.length > 0} onClick={completeWalkthrough}>
          {sending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <CheckCircle2 className="mr-2 h-5 w-5" />}
          {done ? "Send the changes to the account manager" : "Walkthrough complete"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          When every area is measured. The site map goes to the account manager to price and send to the client. Nothing goes to
          the client yet.
        </p>
        {sendNote && <p className="text-center text-sm text-muted-foreground">{sendNote}</p>}
      </div>
    </section>
  );
}
