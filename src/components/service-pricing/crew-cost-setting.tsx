"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateCrewCostPerHour } from "@/lib/actions/organization-actions";

export function CrewCostSetting({ initialRate }: { initialRate: number | null }) {
  const [rate, setRate] = useState(initialRate?.toString() ?? "");
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(() => updateCrewCostPerHour(rate.trim() ? Number(rate) : null));
  }

  return (
    <div className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Crew cost per hour ($)</Label>
        <Input
          type="number"
          step="0.01"
          min={0}
          placeholder="0.00"
          value={rate}
          disabled={isPending}
          onChange={(e) => setRate(e.target.value)}
          onBlur={save}
          className="h-9 w-28 text-sm"
        />
      </div>
      <p className="pb-2 text-xs text-muted-foreground">
        A blended $/hour for a crew member — used to turn a service&apos;s minutes-per-sq-ft into a labor cost.
      </p>
    </div>
  );
}
