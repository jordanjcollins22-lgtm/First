"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateToolDescription } from "@/lib/actions/tool-actions";

/**
 * What the tool is for, in one line.
 *
 * Saved when the field is left rather than on every keystroke: this is a
 * sentence somebody is composing, and a write per character would be a write
 * per character.
 */
export function ToolDescriptionInput({
  toolId,
  initialDescription,
}: {
  toolId: string;
  initialDescription: string | null;
}) {
  const [value, setValue] = useState(initialDescription ?? "");
  const [saved, setSaved] = useState(initialDescription ?? "");
  const [isPending, startTransition] = useTransition();

  function commit() {
    const next = value.trim();
    if (next === saved.trim()) return;
    setSaved(next);
    startTransition(() => updateToolDescription(toolId, next || null));
  }

  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      disabled={isPending}
      maxLength={160}
      placeholder="What it's for — one line, for the kit sheet"
      className="h-8 text-xs"
    />
  );
}
