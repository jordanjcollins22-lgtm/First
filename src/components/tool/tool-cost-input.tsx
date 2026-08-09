"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateToolCost } from "@/lib/actions/tool-actions";

export function ToolCostInput({ toolId, initialCost }: { toolId: string; initialCost: number | null }) {
  const [value, setValue] = useState(initialCost?.toString() ?? "");
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    const parsed = value.trim() ? Number(value) : null;
    startTransition(() => updateToolCost(toolId, parsed));
  }

  return (
    <Input
      type="number"
      step="0.01"
      min={0}
      placeholder="Cost"
      value={value}
      disabled={isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      className="h-9 w-24 text-sm"
    />
  );
}
