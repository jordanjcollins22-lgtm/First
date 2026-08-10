"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateToolKit } from "@/lib/actions/tool-actions";

export function ToolKitInput({ toolId, initialKit }: { toolId: string; initialKit: string | null }) {
  const [value, setValue] = useState(initialKit ?? "");
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    startTransition(() => updateToolKit(toolId, value.trim() || null));
  }

  return (
    <Input
      placeholder="Kit (e.g. Bed Prep Kit)"
      value={value}
      disabled={isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      className="h-9 w-44 text-sm"
    />
  );
}
