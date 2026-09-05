"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateMeasurementUnit } from "@/lib/actions/organization-actions";
import type { MeasurementBasis } from "@/types/domain";

const ADD_NEW = "__add_new__";

const BASIS_LABELS: Record<MeasurementBasis, string> = {
  area: "the zone's measured area",
  perimeter: "the zone's perimeter",
  flat: "nothing — charged once per zone",
};

export function MeasurementUnitSetting({
  initialUnit,
  initialBasis,
}: {
  initialUnit: string;
  initialBasis: MeasurementBasis;
}) {
  const [unit, setUnit] = useState(initialUnit);
  const [basis, setBasis] = useState<MeasurementBasis>(initialBasis);
  const [adding, setAdding] = useState(false);
  const [draftUnit, setDraftUnit] = useState("");
  const [draftBasis, setDraftBasis] = useState<MeasurementBasis>("area");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // "sq ft" is always offered since it's the default and the best basis for
  // material and time; the current unit joins it when it's something else.
  const options = Array.from(new Set(["sq ft", unit]));

  function handleSelect(value: string) {
    if (value === ADD_NEW) {
      setAdding(true);
      setDraftUnit("");
      setDraftBasis("area");
      return;
    }
    setUnit(value);
    const nextBasis: MeasurementBasis = value === "sq ft" ? "area" : basis;
    setBasis(nextBasis);
    setError(null);
    startTransition(() => updateMeasurementUnit(value, nextBasis));
  }

  function handleSaveNew() {
    setError(null);
    startTransition(async () => {
      try {
        await updateMeasurementUnit(draftUnit, draftBasis);
        setUnit(draftUnit.trim());
        setBasis(draftBasis);
        setAdding(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Price and estimate by</Label>
          <Select value={unit} disabled={isPending} onValueChange={handleSelect}>
            <SelectTrigger className="h-9 w-40 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
              <SelectItem value={ADD_NEW}>+ Add new...</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="pb-2 text-xs text-muted-foreground">
          A per-unit price multiplies by {BASIS_LABELS[basis]}. Square feet is best for working out material
          quantities and time.
        </p>
      </div>

      {adding && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Unit name</Label>
              <Input
                value={draftUnit}
                autoFocus
                placeholder="e.g. linear ft, plant, yard"
                onChange={(e) => setDraftUnit(e.target.value)}
                className="h-9 w-44 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">A price per unit multiplies by</Label>
              <Select value={draftBasis} onValueChange={(v) => setDraftBasis(v as MeasurementBasis)}>
                <SelectTrigger className="h-9 w-56 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="area">The zone&apos;s measured area</SelectItem>
                  <SelectItem value="perimeter">The zone&apos;s perimeter</SelectItem>
                  <SelectItem value="flat">Nothing — charged once per zone</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="button" size="sm" disabled={isPending} onClick={handleSaveNew}>
              {isPending ? "Saving..." : "Save unit"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
