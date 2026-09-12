"use client";

import { useState, useTransition } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateToolCategory } from "@/lib/actions/tool-actions";
import type { ToolCategory } from "@/types/domain";

/** Moves an item between the Tools and Crew Gear tabs. Everything else
 * about it carries over, so something entered as a tool by mistake doesn't
 * have to be re-created. */
export function ToolCategorySelect({ toolId, category }: { toolId: string; category: ToolCategory }) {
  const [value, setValue] = useState<ToolCategory>(category);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: string) {
    const category = next === "gear" ? "gear" : "tool";
    setValue(category);
    setError(null);
    startTransition(async () => {
      try {
        await updateToolCategory(toolId, category);
      } catch {
        setValue(value);
        setError("Couldn't move that — try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Select value={value} onValueChange={handleChange} disabled={isPending}>
        <SelectTrigger className="h-9 w-32 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="tool">Tool</SelectItem>
          <SelectItem value="gear">Crew gear</SelectItem>
        </SelectContent>
      </Select>
      {error && <span className="text-[10px] text-destructive">{error}</span>}
    </div>
  );
}
