"use client";

import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";

interface KitPickerProps {
  /** All kit numbers currently used by any tool, so new kits build on the existing sequence. */
  availableKits: number[];
  value: number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
}

export function KitPicker({ availableKits, value, onChange, disabled }: KitPickerProps) {
  const allKnown = [...new Set([...availableKits, ...value])].sort((a, b) => a - b);
  const nextKit = (allKnown.length > 0 ? Math.max(...allKnown) : 0) + 1;

  function toggle(n: number) {
    if (disabled) return;
    onChange(value.includes(n) ? value.filter((k) => k !== n) : [...value, n]);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allKnown.map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => toggle(n)}
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-xs",
            value.includes(n)
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-accent"
          )}
        >
          Kit {n}
        </button>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={() => toggle(nextKit)}
        className="flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
      >
        <Plus className="h-3 w-3" />
        Kit {nextKit}
      </button>
    </div>
  );
}
