"use client";

import { useRef } from "react";

import { previewV2As } from "@/lib/actions/v2-preview-actions";

/**
 * Pick a team member and the new layout is drawn exactly as they would see it:
 * their pages, their choices, their own visits and work days.
 */
export function PreviewAs({
  people,
  currentId,
  meId,
}: {
  people: { id: string; name: string; roles: string }[];
  currentId: string;
  meId: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form data-tour="preview-as" ref={form} action={previewV2As} className="flex items-center gap-2 text-sm">
      <label htmlFor="preview-as" className="text-muted-foreground">
        Preview as
      </label>
      <select
        id="preview-as"
        name="profileId"
        defaultValue={currentId === meId ? "" : currentId}
        onChange={() => form.current?.requestSubmit()}
        className="min-h-10 max-w-[16rem] rounded-lg border bg-card px-2.5 font-semibold"
      >
        <option value="">Me (owner)</option>
        {people
          .filter((p) => p.id !== meId)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.roles ? ` · ${p.roles}` : ""}
            </option>
          ))}
      </select>
    </form>
  );
}
