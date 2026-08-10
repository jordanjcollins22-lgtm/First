"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateToolKits } from "@/lib/actions/tool-actions";

export function ToolKitsInput({ toolId, initialKits }: { toolId: string; initialKits: string[] }) {
  const [value, setValue] = useState(initialKits.join(", "));
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    const kits = value
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    startTransition(() => updateToolKits(toolId, kits));
  }

  return (
    <Input
      placeholder="Kits, comma separated"
      value={value}
      disabled={isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      className="h-9 w-full text-sm"
    />
  );
}
