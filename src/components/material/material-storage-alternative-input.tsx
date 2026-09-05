"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateMaterialStorageAlternative } from "@/lib/actions/material-actions";

export function MaterialStorageAlternativeInput({
  materialId,
  initialValue,
}: {
  materialId: string;
  initialValue: string | null;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    startTransition(() => updateMaterialStorageAlternative(materialId, value.trim() || null));
  }

  return (
    <Input
      placeholder="e.g. Pick up from supplier as needed"
      value={value}
      disabled={isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      className="h-9 w-64 text-sm"
    />
  );
}
