"use client";

import { useRef, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createMaterial } from "@/lib/actions/material-actions";

export function CreateMaterialForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      await createMaterial(formData);
      formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="material-name">Name</Label>
        <Input id="material-name" name="name" required placeholder="Pea Gravel" className="w-40" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="material-unit">Unit</Label>
        <Input id="material-unit" name="unit" required placeholder="cubic yards" className="w-32" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="material-coverage">Sq ft per unit</Label>
        <Input
          id="material-coverage"
          name="coverage_per_unit_sqft"
          type="number"
          step="0.1"
          min={0}
          placeholder="100"
          className="w-28"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="material-waste">Waste %</Label>
        <Input
          id="material-waste"
          name="waste_factor_pct"
          type="number"
          step="0.1"
          min={0}
          placeholder="10"
          className="w-24"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="material-cost">Cost / unit</Label>
        <Input
          id="material-cost"
          name="cost_per_unit"
          type="number"
          step="0.01"
          min={0}
          placeholder="0.00"
          className="w-28"
        />
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Adding..." : "Add Material"}
      </Button>
    </form>
  );
}
