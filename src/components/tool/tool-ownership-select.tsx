"use client";

import { useTransition } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateToolOwnership } from "@/lib/actions/tool-actions";

/** Controlled by the parent row so flipping this instantly updates the
 * rest of the row (cost label, order-status wording) without waiting on a
 * server round trip to reflect back down. */
export function ToolOwnershipSelect({
  toolId,
  isRental,
  onChange,
}: {
  toolId: string;
  isRental: boolean;
  onChange: (isRental: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string) {
    const nextIsRental = value === "rent";
    onChange(nextIsRental);
    startTransition(() => updateToolOwnership(toolId, nextIsRental));
  }

  return (
    <Select value={isRental ? "rent" : "own"} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger className="h-9 w-24 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="own">Own</SelectItem>
        <SelectItem value="rent">Rent</SelectItem>
      </SelectContent>
    </Select>
  );
}
