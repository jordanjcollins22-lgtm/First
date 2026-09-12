"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createJobAtProperty } from "@/lib/actions/job-actions";

/**
 * Books another job at a property that already has one.
 *
 * Adding a property from the home screen jumps to its existing job rather than
 * making a second — right for a first visit, wrong for a customer coming back
 * next season. This is how the repeat job gets created.
 */
export function AddJobButton({ propertyId, address }: { propertyId: string; address: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-9 w-fit items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        <Plus className="h-3.5 w-3.5" />
        Add another job here
      </button>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) return setError("Give the job a name.");

    startTransition(async () => {
      const result = await createJobAtProperty(propertyId, trimmed);
      if (!result.ok) return setError(result.message);
      // The action hands back the new job's id as its message.
      if (result.message) router.push(`/jobs/${result.message}`);
    });
  }

  return (
    <form onSubmit={submit} className="rounded-md border border-border bg-muted/20 p-2">
      <label className="flex flex-col gap-1 text-xs font-medium">
        New job at {address}
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Fall cleanup"
          autoFocus
        />
      </label>
      {error && <p className="mt-1 text-[11px] text-destructive">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="submit" size="sm" className="min-h-9" disabled={isPending}>
          {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Create
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-9"
          disabled={isPending}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
