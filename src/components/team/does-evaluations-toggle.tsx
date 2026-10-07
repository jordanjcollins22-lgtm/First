"use client";

import { useState, useTransition } from "react";

import { cn } from "@/lib/utils";
import { setDoesEvaluations } from "@/lib/actions/team-actions";

/**
 * Whether this person can be sent to a property.
 *
 * It used to be inferred from role names, and role names are free text an
 * organisation invents for itself, so the inference was wrong in both
 * directions: the owner does evaluations and is only ever going to be called
 * "admin", so the booking page would not offer him; and a crew member had one
 * parked on him for a month because nothing said he does not do them.
 *
 * Three states on purpose. "From their role" is the old behaviour and stays
 * the default, so nobody who has not thought about this loses anything. Yes
 * and no are somebody having thought about it, and they win.
 */
export function DoesEvaluationsToggle({
  profileId,
  initial,
  roleSays,
}: {
  profileId: string;
  /** Null means nobody has decided, so the role decides. */
  initial: boolean | null;
  /** What the roles would say on their own, for the default's label. */
  roleSays: boolean;
}) {
  const [value, setValue] = useState<boolean | null>(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const options: { key: "default" | "yes" | "no"; label: string }[] = [
    { key: "yes", label: "Yes" },
    { key: "no", label: "No" },
    { key: "default", label: roleSays ? "From role (yes)" : "From role (no)" },
  ];

  const current = value === null ? "default" : value ? "yes" : "no";

  function choose(key: "default" | "yes" | "no") {
    const next = key === "default" ? null : key === "yes";
    const previous = value;
    setValue(next);
    setError(null);
    start(async () => {
      const result = await setDoesEvaluations({ profileId, value: next });
      if (!result.ok) {
        setValue(previous);
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            disabled={pending}
            onClick={() => choose(option.key)}
            className={cn(
              "min-h-7 rounded-full border px-2 text-[11px]",
              current === option.key
                ? "border-primary bg-primary/10 font-medium text-primary"
                : "border-border text-muted-foreground hover:bg-accent"
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
