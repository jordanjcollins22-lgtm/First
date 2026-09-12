"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateToolShopLocation } from "@/lib/actions/tool-actions";

export function ToolShopLocationInput({
  toolId,
  initialValue,
}: {
  toolId: string;
  initialValue: string | null;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    startTransition(() => updateToolShopLocation(toolId, value.trim() || null));
  }

  return (
    <Input
      placeholder="e.g. Shelf 3, Bin B"
      value={value}
      disabled={isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      className="h-9 w-40 text-sm"
    />
  );
}
