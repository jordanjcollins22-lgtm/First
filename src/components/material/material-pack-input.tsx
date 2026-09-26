"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateMaterialPack } from "@/lib/actions/material-actions";
import { derivedCostPerUnit } from "@/lib/pricing";

/** What a purchase actually looks like — a 25-pack of blades for $18 —
 * with the per-unit price quoting uses derived from it. */
export function MaterialPackInput({
  materialId,
  initialPackSize,
  initialPackCost,
}: {
  materialId: string;
  initialPackSize: number | null;
  initialPackCost: number | null;
}) {
  const [packSize, setPackSize] = useState(initialPackSize?.toString() ?? "");
  const [packCost, setPackCost] = useState(initialPackCost?.toString() ?? "");
  const [isPending, startTransition] = useTransition();

  const perUnit = derivedCostPerUnit(
    packSize.trim() ? Number(packSize) : null,
    packCost.trim() ? Number(packCost) : null,
    null
  );

  function save() {
    startTransition(() =>
      updateMaterialPack(materialId, packSize.trim() ? Number(packSize) : null, packCost.trim() ? Number(packCost) : null)
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          step="1"
          min={0}
          placeholder="25"
          value={packSize}
          disabled={isPending}
          onChange={(e) => setPackSize(e.target.value)}
          onBlur={save}
          className="h-9 w-20 text-sm"
        />
        <span className="text-xs text-muted-foreground">for $</span>
        <Input
          type="number"
          step="0.01"
          min={0}
          placeholder="0.00"
          value={packCost}
          disabled={isPending}
          onChange={(e) => setPackCost(e.target.value)}
          onBlur={save}
          className="h-9 w-24 text-sm"
        />
      </div>
      {perUnit != null && (
        <span className="text-[10px] text-primary">= ${perUnit.toFixed(2)} per unit, used for quoting</span>
      )}
    </div>
  );
}
