"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { updateMaterialStorageLocation } from "@/lib/actions/material-actions";

export function MaterialStorageLocationInput({
  materialId,
  initialLocation,
  stockMethod,
}: {
  materialId: string;
  initialLocation: string | null;
  stockMethod: "in_stock" | "order_as_needed";
}) {
  const [value, setValue] = useState(initialLocation ?? "");
  const [isPending, startTransition] = useTransition();

  const missing = stockMethod === "in_stock" && !value.trim();

  function handleBlur() {
    startTransition(() => updateMaterialStorageLocation(materialId, value.trim() || null));
  }

  return (
    <Input
      placeholder={missing ? "⚠ Add location" : "e.g. Yard bin 2, Shed"}
      value={value}
      disabled={isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      className={cn("h-9 w-36 text-sm", missing && "border-destructive text-destructive placeholder:text-destructive")}
    />
  );
}
