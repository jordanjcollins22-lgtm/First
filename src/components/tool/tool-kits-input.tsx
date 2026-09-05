"use client";

import { useState, useTransition } from "react";

import { KitPicker } from "./kit-picker";
import { updateToolKits } from "@/lib/actions/tool-actions";

export function ToolKitsInput({
  toolId,
  initialKits,
  availableKits,
}: {
  toolId: string;
  initialKits: number[];
  availableKits: number[];
}) {
  const [kits, setKits] = useState<number[]>(initialKits);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: number[]) {
    setKits(next);
    startTransition(() => updateToolKits(toolId, next));
  }

  return (
    <KitPicker availableKits={availableKits} value={kits} onChange={handleChange} disabled={isPending} />
  );
}
