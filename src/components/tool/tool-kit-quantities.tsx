"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateToolKitQuantity } from "@/lib/actions/tool-actions";

/**
 * How many of this tool go in each kit it belongs to.
 *
 * Separate from how many we own, which is what the checklist used to print.
 * We have three flat shovels and the kit takes one, so the sheet said "× 3"
 * beside a kit holding one and sent whoever was counting the van looking for
 * two that were never in it.
 *
 * Only shown for kits the tool is actually in, and only worth touching for the
 * exceptions — every box starts at one, which is nearly always right.
 */
export function ToolKitQuantities({
  toolId,
  kits,
  quantities,
}: {
  toolId: string;
  kits: number[];
  quantities: Record<string, number>;
}) {
  if (kits.length === 0) return null;

  return (
    <div className="flex flex-wrap items-end gap-2">
      {kits
        .slice()
        .sort((a, b) => a - b)
        .map((kit) => (
          <KitCount key={kit} toolId={toolId} kit={kit} initial={quantities?.[String(kit)] ?? 1} />
        ))}
    </div>
  );
}

function KitCount({ toolId, kit, initial }: { toolId: string; kit: number; initial: number }) {
  const [value, setValue] = useState(String(initial));
  const [saved, setSaved] = useState(String(initial));
  const [isPending, startTransition] = useTransition();

  function commit() {
    const n = Math.max(1, Math.min(99, Math.round(Number(value) || 1)));
    setValue(String(n));
    if (String(n) === saved) return;
    setSaved(String(n));
    startTransition(() => updateToolKitQuantity(toolId, kit, n));
  }

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">Kit {kit}</span>
      <Input
        type="number"
        min={1}
        max={99}
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        disabled={isPending}
        className="h-8 w-16 text-xs"
      />
    </label>
  );
}
