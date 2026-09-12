"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateToolNotOwnedReason } from "@/lib/actions/tool-actions";

export function ToolNotOwnedReasonInput({ toolId, initialReason }: { toolId: string; initialReason: string | null }) {
  const [value, setValue] = useState(initialReason ?? "");
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    startTransition(() => updateToolNotOwnedReason(toolId, value.trim() || null));
  }

  return (
    <Input
      placeholder="e.g. Too expensive to buy outright"
      value={value}
      disabled={isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      className="h-9 w-64 text-sm"
    />
  );
}
