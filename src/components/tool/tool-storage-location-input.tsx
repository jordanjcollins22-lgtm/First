"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateToolStorageLocation } from "@/lib/actions/tool-actions";

export function ToolStorageLocationInput({
  toolId,
  initialLocation,
}: {
  toolId: string;
  initialLocation: string | null;
}) {
  const [value, setValue] = useState(initialLocation ?? "");
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    startTransition(() => updateToolStorageLocation(toolId, value.trim() || null));
  }

  return (
    <Input
      placeholder="e.g. Shop shelf 3, Truck 1"
      value={value}
      disabled={isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      className="h-9 w-36 text-sm"
    />
  );
}
