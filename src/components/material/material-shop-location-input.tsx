"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateMaterialShopLocation } from "@/lib/actions/material-actions";

export function MaterialShopLocationInput({
  materialId,
  initialValue,
}: {
  materialId: string;
  initialValue: string | null;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    startTransition(() => updateMaterialShopLocation(materialId, value.trim() || null));
  }

  return (
    <Input
      placeholder="e.g. Yard shelf 2"
      value={value}
      disabled={isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      className="h-9 w-40 text-sm"
    />
  );
}
