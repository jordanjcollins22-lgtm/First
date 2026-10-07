"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateToolCost } from "@/lib/actions/tool-actions";

export function ToolCostInput({
  toolId,
  initialCost,
  isRental,
}: {
  toolId: string;
  initialCost: number | null;
  isRental: boolean;
}) {
  const [value, setValue] = useState(initialCost?.toString() ?? "");
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    const parsed = value.trim() ? Number(value) : null;
    startTransition(() => updateToolCost(toolId, parsed));
  }

  return (
    <div className="flex flex-col gap-0.5">
      {isRental && <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">Per day</span>}
      <Input
        type="number"
        step="0.01"
        min={0}
        placeholder={isRental ? "Cost/day" : "Cost"}
        value={value}
        disabled={isPending}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        className="h-9 w-24 text-sm"
      />
    </div>
  );
}
