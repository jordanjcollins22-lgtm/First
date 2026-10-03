"use client";

import { useState, useTransition } from "react";

import { cn } from "@/lib/utils";
import { setCanEditTools } from "@/lib/actions/team-actions";

/**
 * Whether this person can change tools, kits and their photos. Off unless the
 * owner turns it on; only the owner sees the switch.
 */
export function CanEditToolsToggle({ profileId, initial }: { profileId: string; initial: boolean }) {
  const [value, setValue] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function choose(next: boolean) {
    if (next === value) return;
    const previous = value;
    setValue(next);
    setError(null);
    start(async () => {
      const result = await setCanEditTools({ profileId, value: next });
      if (!result.ok) {
        setValue(previous);
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {[
          { key: true, label: "Allowed" },
          { key: false, label: "Not allowed" },
        ].map((option) => (
          <button
            key={String(option.key)}
            type="button"
            disabled={pending}
            onClick={() => choose(option.key)}
            className={cn(
              "min-h-7 rounded-full border px-2 text-[11px]",
              value === option.key ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
