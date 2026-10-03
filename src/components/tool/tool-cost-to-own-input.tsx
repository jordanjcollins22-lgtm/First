"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateToolCostToOwn } from "@/lib/actions/tool-actions";

export function ToolCostToOwnInput({ toolId, initialCost }: { toolId: string; initialCost: number | null }) {
  const [value, setValue] = useState(initialCost?.toString() ?? "");
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    const parsed = value.trim() ? Number(value) : null;
    startTransition(() => updateToolCostToOwn(toolId, parsed));
  }

  return (
    <Input
      type="number"
      step="0.01"
      min={0}
      placeholder="0.00"
      value={value}
      disabled={isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      className="h-9 w-28 text-sm"
    />
  );
}
