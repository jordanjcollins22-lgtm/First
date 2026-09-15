"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateMaterialPurchaseUrl } from "@/lib/actions/material-actions";

export function MaterialPurchaseLinkInput({
  materialId,
  initialUrl,
}: {
  materialId: string;
  initialUrl: string | null;
}) {
  const [value, setValue] = useState(initialUrl ?? "");
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    startTransition(() => updateMaterialPurchaseUrl(materialId, value.trim() || null));
  }

  return (
    <Input
      type="url"
      placeholder="https://... link to buy this"
      value={value}
      disabled={isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      className="h-9 w-64 text-sm"
    />
  );
}
