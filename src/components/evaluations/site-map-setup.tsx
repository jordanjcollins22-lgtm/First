"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ImageCanvasBoard } from "@/components/canvas/image-canvas-board";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import type { CanvasDesignRow, EvaluationStatus } from "@/types/domain";
import { saveVisitPlan } from "@/lib/actions/evaluation-visit-actions";
import { PHOTO_AREAS } from "@/lib/evaluation-intake";
import { addedItem, areaLabel, zoneSeeds, type PlanItem } from "@/lib/evaluation-visit";
import type { LotData } from "@/lib/lot-map";
import { cn } from "@/lib/utils";

/**
 * The site map on site, already set up from the client's pre-evaluation
 * form: every piece of work they asked for is on the map when it opens,
 * named, with its service, over the part of the yard it is in.
 *
 * Under the map, what is on it, each with Remove (or Put back), and Add for
 * anything they did not ask for: pick where, then what. Deleting one on
 * the map itself counts as Remove, so it is not put back. Then the
 * evaluator measures each area, adds photos and submits, on the map they
 * already know.
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

  const seeds = useMemo(() => zoneSeeds(plan), [plan]);
  const onMap = plan.filter((i) => i.keep !== false);
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
          {plan.length > 0
            ? "Already set up from their pre-eval. Tap each area to measure it and add photos, then Submit."
            : "Draw each area, measure it and add photos, then Submit."}
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
      />

      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
        <p className="text-sm font-semibold">On the map ({onMap.length})</p>
        {onMap.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet. Add what they want below.</p>}
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
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Taken off</p>
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
    </section>
  );
}
