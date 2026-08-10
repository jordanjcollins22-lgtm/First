"use client";

import { useRef, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTool } from "@/lib/actions/tool-actions";

export function CreateToolForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      await createTool(formData);
      formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tool-name">Name</Label>
        <Input id="tool-name" name="name" required placeholder="Chainsaw" className="w-40" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tool-icon">Icon (emoji)</Label>
        <Input id="tool-icon" name="icon" placeholder="🧰" className="w-20" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tool-cost">Cost</Label>
        <Input id="tool-cost" name="cost" type="number" step="0.01" min={0} placeholder="0.00" className="w-28" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tool-kit">Kit</Label>
        <Input id="tool-kit" name="kit" placeholder="e.g. Bed Prep Kit" className="w-44" />
      </div>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" name="is_rental" className="h-4 w-4" />
        Rental item
      </label>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Adding..." : "Add Tool"}
      </Button>
    </form>
  );
}
