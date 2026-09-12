"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateMaterialCost } from "@/lib/actions/material-actions";

export function MaterialCostInput({ materialId, initialCost }: { materialId: string; initialCost: number | null }) {
  const [value, setValue] = useState(initialCost?.toString() ?? "");
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    const parsed = value.trim() ? Number(value) : null;
    startTransition(() => updateMaterialCost(materialId, parsed));
  }

  return (
    <Input
      type="number"
      step="0.01"
      min={0}
      placeholder="Cost/unit"
      value={value}
      disabled={isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      className="h-9 w-28 text-sm"
    />
  );
}
