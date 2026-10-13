"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveTerritory, type TerritoryResult } from "@/lib/actions/territory-actions";
import type { LatLng } from "@/lib/sales/territories";
import { TerritoryMap } from "@/components/v2/panels/sales/territory-map";

export interface EvaluatorTerritoryView {
  id: string;
  name: string;
  zips: string[];
  areas: LatLng[][];
  active: boolean;
  bookings: number;
  inTerritory: number;
}

/**
 * Pick an evaluator, then type their zip codes, draw their areas, or both.
 * Saving with neither clears it: they cover everywhere again.
 */
export function TerritoriesEditor({ evaluators, pins }: { evaluators: EvaluatorTerritoryView[]; pins: { lat: number; lng: number; evaluatorId: string | null }[] }) {
  const [selected, setSelected] = useState(evaluators[0]?.id ?? null);
  const current = evaluators.find((e) => e.id === selected) ?? null;
  if (evaluators.length === 0) {
    return <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">Nobody is marked as doing evaluations yet. Tick it on their profile on the Team page.</p>;
  }
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Evaluators">
        {evaluators.map((e) => (
          <button
            key={e.id}
            type="button"
            role="tab"
            aria-selected={e.id === selected}
            onClick={() => setSelected(e.id)}
            className={`min-h-11 rounded-full border px-4 text-sm font-medium ${e.id === selected ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
          >
            {e.name}
            <span className="ml-2 text-xs opacity-75">{e.zips.length || e.areas.length ? "territory set" : "anywhere"}</span>
          </button>
        ))}
      </div>
      {current && (
        <EditOne
          key={current.id}
          evaluator={current}
          others={evaluators.filter((e) => e.id !== current.id).flatMap((e) => e.areas)}
          pins={pins.map((p) => ({ lat: p.lat, lng: p.lng, mine: p.evaluatorId === current.id }))}
        />
      )}
    </div>
  );
}

function EditOne({ evaluator, others, pins }: { evaluator: EvaluatorTerritoryView; others: LatLng[][]; pins: { lat: number; lng: number; mine: boolean }[] }) {
  const [zips, setZips] = useState(evaluator.zips.join(", "));
  const [areas, setAreas] = useState<LatLng[][]>(evaluator.areas);
  const [active, setActive] = useState(evaluator.active);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<TerritoryResult | null>(null);
  return (
    <div className="grid gap-3 rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">
        {evaluator.bookings} evaluation{evaluator.bookings === 1 ? "" : "s"} in the last 90 days
        {evaluator.zips.length || evaluator.areas.length ? `, ${evaluator.inTerritory} inside their territory` : ""}. Green dots are theirs.
      </p>
      <label className="grid gap-1 text-sm font-medium">
        Zip codes
        <Input className="min-h-11" placeholder="21014, 21015, 21050" value={zips} onChange={(e) => setZips(e.target.value)} />
      </label>
      <div className="grid gap-1">
        <p className="text-sm font-medium">Or draw their areas</p>
        <p className="text-xs text-muted-foreground">Use the shape tool at the top left; the bin removes one. Grey areas belong to somebody else.</p>
        <TerritoryMap areas={evaluator.areas} others={others} pins={pins} onChange={setAreas} />
        <p className="text-xs text-muted-foreground">{areas.length} area{areas.length === 1 ? "" : "s"} drawn.</p>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" className="h-5 w-5" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Use this territory when routing bookings (from /book and GoHighLevel)
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button className="min-h-11" disabled={pending} onClick={() => start(async () => setResult(await saveTerritory({ evaluatorId: evaluator.id, zips, areas, active })))}>
          {pending ? "Saving…" : "Save territory"}
        </Button>
        {result && (
          <p role="status" className={`text-sm ${result.ok ? "text-muted-foreground" : "text-red-700 dark:text-red-300"}`}>
            {result.ok ? result.message : result.error}
          </p>
        )}
      </div>
    </div>
  );
}
