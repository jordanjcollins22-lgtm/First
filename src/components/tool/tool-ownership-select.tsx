"use client";

import { useTransition } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateToolOwnership } from "@/lib/actions/tool-actions";

export function ToolOwnershipSelect({ toolId, initialIsRental }: { toolId: string; initialIsRental: boolean }) {
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string) {
    startTransition(() => updateToolOwnership(toolId, value === "rent"));
  }

  return (
    <Select defaultValue={initialIsRental ? "rent" : "own"} onValueChange={handleChange} disabled={isPending}>
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
