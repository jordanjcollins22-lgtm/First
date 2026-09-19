"use client";

import { useState, useTransition } from "react";

import { Textarea } from "@/components/ui/textarea";
import { updateMaterialDescription } from "@/lib/actions/material-actions";

export function MaterialDescriptionInput({
  materialId,
  initialDescription,
}: {
  materialId: string;
  initialDescription: string | null;
}) {
  const [value, setValue] = useState(initialDescription ?? "");
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    startTransition(() => updateMaterialDescription(materialId, value.trim() || null));
  }

  return (
    <Textarea
      placeholder="Product description (optional)"
      value={value}
      disabled={isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      className="h-20 w-72 text-sm"
    />
  );
}
