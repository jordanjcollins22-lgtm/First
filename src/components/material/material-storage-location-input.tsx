"use client";

import { useState, useTransition } from "react";

import { StorageLocationSelect } from "@/components/inventory/storage-location-select";
import { updateMaterialStorageLocation } from "@/lib/actions/material-actions";

export function MaterialStorageLocationInput({
  materialId,
  initialLocation,
  stockMethod,
  locations,
}: {
  materialId: string;
  initialLocation: string | null;
  stockMethod: "in_stock" | "order_as_needed";
  locations: string[];
}) {
  const [value, setValue] = useState(initialLocation ?? "");
  const [isPending, startTransition] = useTransition();

  const missing = stockMethod === "in_stock" && !value.trim();

  function handleChange(next: string) {
    setValue(next);
    startTransition(() => updateMaterialStorageLocation(materialId, next.trim() || null));
  }

  return (
    <StorageLocationSelect
      locations={locations}
      value={value}
      onChange={handleChange}
      invalid={missing}
      disabled={isPending}
      className="w-36"
    />
  );
}
