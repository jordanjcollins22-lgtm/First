"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Check, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ImageCanvasBoard } from "@/components/canvas/image-canvas-board";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import type { CanvasDesignRow, EvaluationStatus } from "@/types/domain";
import { saveVisitPlan } from "@/lib/actions/evaluation-visit-actions";
import { PHOTO_AREAS } from "@/lib/evaluation-intake";
import { addedItem, areaLabel, planAnswered, zoneSeeds, type PlanItem } from "@/lib/evaluation-visit";
import type { LotData } from "@/lib/lot-map";
import { cn } from "@/lib/utils";

/**
 * The site map set-up on site, then the site map itself.
 *
 * Each piece of work from the client's form is one question: doing it, yes
 * or no. Anything else is added by picking where and what. Then Build the
 * site map puts the kept pieces on the map, drawn over the part of the yard
 * each is in, for the evaluator to measure and submit with the map they
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
  alreadyBuilt,
  preview = false,
  demoLot = null,
  mapOnly = false,
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
  alreadyBuilt: boolean;
  /** For the owner's walk-through: answers are not saved and the map is the practice one. */
  preview?: boolean;
  demoLot?: LotData | null;
  /** Just the site map, for the walk-through's page after the set-up. */
  mapOnly?: boolean;
}) {
  const [plan, setPlan] = useState<PlanItem[]>(initialPlan);
  const [built, setBuilt] = useState(alreadyBuilt);
  const [adding, setAdding] = useState(false);
  const [addArea, setAddArea] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const mapRef = useRef<HTMLDivElement>(null);

  const answered = planAnswered(plan);
  const kept = plan.filter((i) => i.keep === true).length;
  const left = plan.filter((i) => i.keep === null).length;
  // Only once they have said Build: the map is not filled in mid-question.
  const seeds = useMemo(() => (built ? zoneSeeds(plan) : undefined), [built, plan]);

  function save(next: PlanItem[]) {
    setPlan(next);
    setError(null);
    if (preview) return;
    start(async () => {
      const result = await saveVisitPlan(jobId, next);
      if (!result.ok) setError(result.message);
    });
  }

  function answer(id: string, keep: boolean) {
    save(plan.map((i) => (i.id === id ? { ...i, keep } : i)));
  }

  function add(typeId: string, name: string) {
    if (!addArea) return;
    save([...plan, addedItem(addArea, typeId, name, crypto.randomUUID().slice(0, 8))]);
    setAdding(false);
    setAddArea(null);
  }

  // Grouped by part of the yard, in the form's order.
  const areas = PHOTO_AREAS.map((a) => a.value).filter((a) => plan.some((i) => i.area === a));

  return (
    <div className="flex flex-col gap-4">
      {!mapOnly && (
        <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Set up the site map</h2>
            <p className="text-xs text-muted-foreground">
              {kept} doing{left > 0 ? `, ${left} to answer` : ""}
            </p>
          </div>
          {plan.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing from the form yet. Add what they want below.</p>
          )}

          {areas.map((area) => (
            <div key={area} className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{areaLabel(area)}</p>
              {plan
                .filter((i) => i.area === area)
                .map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-xl border p-3",
                      item.keep === true ? "border-primary/50 bg-primary/5" : item.keep === false ? "border-border bg-muted/40 opacity-70" : "border-border"
                    )}
                  >
                    <div className="min-w-0">
                      <p className={cn("font-medium", item.keep === false && "line-through")}>{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.added ? "Added on site" : "From their form"} · Doing this?</p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        aria-pressed={item.keep === true}
                        onClick={() => answer(item.id, true)}
                        className={cn(
                          "flex h-11 min-w-16 items-center justify-center gap-1 rounded-lg border px-3 font-semibold",
                          item.keep === true ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"
                        )}
                      >
                        <Check className="h-4 w-4" /> Yes
                      </button>
                      <button
                        type="button"
                        aria-pressed={item.keep === false}
                        onClick={() => answer(item.id, false)}
                        className={cn(
                          "flex h-11 min-w-16 items-center justify-center gap-1 rounded-lg border px-3 font-semibold",
                          item.keep === false ? "border-foreground bg-foreground text-background" : "border-border bg-background"
                        )}
                      >
                        <X className="h-4 w-4" /> No
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          ))}

          {!adding ? (
            <Button type="button" variant="outline" className="h-12 self-stretch" onClick={() => setAdding(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Add something they didn&apos;t ask for
            </Button>
          ) : (
            <div className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3">
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
              <button type="button" className="self-start text-sm text-muted-foreground underline" onClick={() => (setAdding(false), setAddArea(null))}>
                Cancel
              </button>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          {!built && (
            <Button
              type="button"
              className="h-14 text-base font-semibold"
              disabled={!answered || kept === 0}
              onClick={() => {
                setBuilt(true);
                setTimeout(() => mapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
              }}
            >
              Build the site map
            </Button>
          )}
          {!built && !answered && plan.length > 0 && <p className="-mt-1 text-center text-xs text-muted-foreground">Answer Yes or No to each one first.</p>}
        </section>
      )}

      {built && (
        <section ref={mapRef} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">The site map</h2>
          <ol className="list-inside list-decimal text-sm text-muted-foreground">
            <li>Each Yes is on the map, over the part of the yard it is in.</li>
            <li>Tap each one to measure it and add photos. Redraw any that are in the wrong place.</li>
            <li>Draw anything else you find, then Submit.</li>
          </ol>
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
          />
        </section>
      )}
    </div>
  );
}
