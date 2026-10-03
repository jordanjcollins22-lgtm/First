"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateToolQuantity } from "@/lib/actions/tool-actions";

export function ToolQuantityInput({ toolId, initialQuantity }: { toolId: string; initialQuantity: number | null }) {
  const [value, setValue] = useState(initialQuantity?.toString() ?? "");
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    const parsed = value.trim() ? Math.max(0, Math.round(Number(value))) : null;
    startTransition(() => updateToolQuantity(toolId, parsed));
  }

  return (
    <Input
      type="number"
      step="1"
      min={0}
      placeholder="Qty"
      value={value}
      disabled={isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      className="h-9 w-20 text-sm"
    />
  );
}
