"use client";

import { useTransition } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateMaterialCanStore } from "@/lib/actions/material-actions";

export function MaterialCanStoreSelect({ materialId, initialCanStore }: { materialId: string; initialCanStore: boolean }) {
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string) {
    startTransition(() => updateMaterialCanStore(materialId, value === "yes"));
  }

  return (
    <Select defaultValue={initialCanStore ? "yes" : "no"} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger className="h-9 w-24 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="yes">Yes</SelectItem>
        <SelectItem value="no">No</SelectItem>
      </SelectContent>
    </Select>
  );
}
