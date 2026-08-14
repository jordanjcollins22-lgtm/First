"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateProfilePayRate } from "@/lib/actions/team-actions";

export function PayRateInput({ profileId, initialRate }: { profileId: string; initialRate: number | null }) {
  const [value, setValue] = useState(initialRate?.toString() ?? "");
  const [isPending, startTransition] = useTransition();

  function handleBlur() {
    startTransition(() => updateProfilePayRate(profileId, value.trim() ? Number(value) : null));
  }

  return (
    <Input
      type="number"
      step="0.01"
      min={0}
      placeholder="$/hr"
      value={value}
      disabled={isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      className="h-9 w-24 text-sm"
    />
  );
}
