"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateMaterialReorderThreshold } from "@/lib/actions/material-actions";

export function MaterialReorderThresholdInput({
  materialId,
  initialThreshold,
}: {
  materialId: string;
  initialThreshold: number | null;
}) {
  const [value, setValue] = useState(initialThreshold?.toString() ?? "");
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    const parsed = value.trim() ? Math.max(0, Number(value)) : null;
    startTransition(() => updateMaterialReorderThreshold(materialId, parsed));
  }

  return (
    <Input
      type="number"
      step="0.1"
      min={0}
      placeholder="Reorder at"
      value={value}
      disabled={isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      className="h-9 w-24 text-sm"
    />
  );
}
