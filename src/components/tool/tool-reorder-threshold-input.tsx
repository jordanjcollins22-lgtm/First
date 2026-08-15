"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateToolReorderThreshold } from "@/lib/actions/tool-actions";

export function ToolReorderThresholdInput({
  toolId,
  initialThreshold,
}: {
  toolId: string;
  initialThreshold: number | null;
}) {
  const [value, setValue] = useState(initialThreshold?.toString() ?? "");
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    const parsed = value.trim() ? Math.max(0, Math.round(Number(value))) : null;
    startTransition(() => updateToolReorderThreshold(toolId, parsed));
  }

  return (
    <Input
      type="number"
      step="1"
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
