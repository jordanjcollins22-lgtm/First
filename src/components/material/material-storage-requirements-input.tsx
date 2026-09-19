"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateMaterialStorageRequirements } from "@/lib/actions/material-actions";

export function MaterialStorageRequirementsInput({
  materialId,
  initialValue,
}: {
  materialId: string;
  initialValue: string | null;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    startTransition(() => updateMaterialStorageRequirements(materialId, value.trim() || null));
  }

  return (
    <Input
      placeholder="e.g. Covered, dry area"
      value={value}
      disabled={isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      className="h-9 w-56 text-sm"
    />
  );
}
