"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { updateToolStorageLocation } from "@/lib/actions/tool-actions";

export function ToolStorageLocationInput({
  toolId,
  initialLocation,
  stockMethod,
}: {
  toolId: string;
  initialLocation: string | null;
  stockMethod: "in_stock" | "order_as_needed";
}) {
  const [value, setValue] = useState(initialLocation ?? "");
  const [isPending, startTransition] = useTransition();

  const missing = stockMethod === "in_stock" && !value.trim();

  function handleBlur() {
    startTransition(() => updateToolStorageLocation(toolId, value.trim() || null));
  }

  return (
    <Input
      placeholder={missing ? "⚠ Add location" : "e.g. Shop shelf 3, Truck 1"}
      value={value}
      disabled={isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      className={cn("h-9 w-36 text-sm", missing && "border-destructive text-destructive placeholder:text-destructive")}
    />
  );
}
