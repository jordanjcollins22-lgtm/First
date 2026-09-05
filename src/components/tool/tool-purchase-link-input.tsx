"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateToolPurchaseUrl } from "@/lib/actions/tool-actions";

export function ToolPurchaseLinkInput({ toolId, initialUrl }: { toolId: string; initialUrl: string | null }) {
  const [value, setValue] = useState(initialUrl ?? "");
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    startTransition(() => updateToolPurchaseUrl(toolId, value.trim() || null));
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
