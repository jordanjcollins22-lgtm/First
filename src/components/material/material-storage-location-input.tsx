"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateMaterialStorageLocation } from "@/lib/actions/material-actions";

export function MaterialStorageLocationInput({
  materialId,
  initialLocation,
}: {
  materialId: string;
  initialLocation: string | null;
}) {
  const [value, setValue] = useState(initialLocation ?? "");
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    startTransition(() => updateMaterialStorageLocation(materialId, value.trim() || null));
  }

  return (
    <Input
      placeholder="e.g. Yard bin 2, Shed"
      value={value}
      disabled={isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      className="h-9 w-36 text-sm"
    />
  );
}
