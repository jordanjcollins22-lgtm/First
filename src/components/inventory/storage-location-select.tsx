"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const NONE = "__none__";
const ADD_NEW = "__add_new__";

/** Distinct storage locations already in use, for the picker's option list.
 * There's no locations table — a storage location is just text on the tool
 * or material, so the list is whatever the business has already typed. */
export function storageLocationOptions(items: { storage_location: string | null }[]): string[] {
  return Array.from(
    new Set(items.map((item) => item.storage_location?.trim()).filter((value): value is string => Boolean(value)))
  ).sort((a, b) => a.localeCompare(b));
}

/** Pick from the locations already in use rather than retyping one (and
 * risking "Truck 1" / "truck 1" / "Truck1" all becoming separate places),
 * with an inline field for the first time a new location comes up. */
export function StorageLocationSelect({
  locations,
  value,
  onChange,
  invalid = false,
  disabled = false,
  className,
}: {
  locations: string[];
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  // A location typed in before this picker existed still has to be selectable.
  const trimmed = value.trim();
  const options = Array.from(new Set([...locations, ...(trimmed ? [trimmed] : [])])).sort((a, b) =>
    a.localeCompare(b)
  );

  function handleSelect(next: string) {
    if (next === ADD_NEW) {
      setDraft("");
      setAdding(true);
      return;
    }
    onChange(next === NONE ? "" : next);
  }

  function commitNew() {
    const next = draft.trim();
    if (!next) return;
    onChange(next);
    setAdding(false);
    setDraft("");
  }

  if (adding) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitNew();
            } else if (e.key === "Escape") {
              setAdding(false);
            }
          }}
          placeholder="e.g. Truck 1"
          className="h-9 text-sm"
        />
        <Button type="button" size="sm" onClick={commitNew} disabled={!draft.trim()}>
          Add
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <Select value={trimmed || NONE} onValueChange={handleSelect} disabled={disabled}>
      <SelectTrigger
        className={cn("h-9 text-sm", invalid && "border-destructive text-destructive", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{invalid ? "⚠ Add location" : "Not set"}</SelectItem>
        {options.map((location) => (
          <SelectItem key={location} value={location}>
            {location}
          </SelectItem>
        ))}
        <SelectItem value={ADD_NEW}>+ Add new location</SelectItem>
      </SelectContent>
    </Select>
  );
}
