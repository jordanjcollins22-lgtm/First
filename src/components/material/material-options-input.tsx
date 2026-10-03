"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { updateMaterialOptions } from "@/lib/actions/material-actions";

/** Chip list of the types or colors a material comes in — leave empty to skip asking. */
export function MaterialOptionsInput({
  materialId,
  optionKey,
  initialOptions,
  placeholder,
}: {
  materialId: string;
  optionKey: "type_options" | "color_options";
  initialOptions: string[];
  placeholder: string;
}) {
  const [options, setOptions] = useState<string[]>(initialOptions);
  const [draft, setDraft] = useState("");
  const [isPending, startTransition] = useTransition();

  function save(next: string[]) {
    setOptions(next);
    startTransition(() => updateMaterialOptions(materialId, optionKey, next));
  }

  function handleAdd() {
    const trimmed = draft.trim();
    if (!trimmed || options.includes(trimmed)) return;
    save([...options, trimmed]);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-1.5">
      {options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {options.map((option, index) => (
            <span
              key={option}
              className="flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs"
            >
              {option}
              <button
                type="button"
                disabled={isPending}
                onClick={() => save(options.filter((_, i) => i !== index))}
                aria-label={`Remove ${option}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        placeholder={placeholder}
        value={draft}
        disabled={isPending}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleAdd}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleAdd();
          }
        }}
        className="h-9 w-44 text-sm"
      />
    </div>
  );
}
