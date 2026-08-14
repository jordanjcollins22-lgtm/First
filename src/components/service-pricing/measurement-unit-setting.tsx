"use client";

import { useState, useTransition } from "react";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateMeasurementUnit } from "@/lib/actions/organization-actions";
import type { MeasurementUnit } from "@/types/domain";

export function MeasurementUnitSetting({ initialUnit }: { initialUnit: MeasurementUnit }) {
  const [unit, setUnit] = useState<MeasurementUnit>(initialUnit);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: MeasurementUnit) {
    setUnit(next);
    startTransition(() => updateMeasurementUnit(next));
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Price and estimate by</Label>
        <Select value={unit} disabled={isPending} onValueChange={(v) => handleChange(v as MeasurementUnit)}>
          <SelectTrigger className="h-9 w-36 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sq ft">Square feet</SelectItem>
            <SelectItem value="linear ft">Linear feet</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="pb-2 text-xs text-muted-foreground">
        Square feet is best for working out material quantities and time — a per-unit price multiplies by each
        zone&apos;s measured area. Linear feet multiplies by the perimeter instead.
      </p>
    </div>
  );
}
