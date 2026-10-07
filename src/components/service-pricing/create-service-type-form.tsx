"use client";

import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createServiceType } from "@/lib/actions/service-pricing-actions";
import { priceFromCogs } from "@/lib/pricing";

export function CreateServiceTypeForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [cogs, setCogs] = useState("");
  const [cost, setCost] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCogsChange(value: string) {
    setCogs(value);
    setCost(value.trim() ? priceFromCogs(Number(value)).toString() : "");
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await createServiceType(formData);
        formRef.current?.reset();
        setCogs("");
        setCost("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-service-name">Name</Label>
          <Input id="new-service-name" name="name" required placeholder="e.g. Paver Patio Install" className="w-48" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-service-cogs">COGS</Label>
          <Input
            id="new-service-cogs"
            name="cogs"
            type="number"
            step="0.01"
            min={0}
            placeholder="0.00"
            value={cogs}
            onChange={(e) => handleCogsChange(e.target.value)}
            className="w-28"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-service-cost">Price {cogs.trim() && "(auto from COGS)"}</Label>
          <Input
            id="new-service-cost"
            name="cost"
            type="number"
            step="0.01"
            min={0}
            placeholder="0.00"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            className="w-28"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-service-unit">Unit</Label>
          <Input id="new-service-unit" name="cost_unit" placeholder="flat rate" className="w-32" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-service-hours">Est. hours</Label>
          <Input id="new-service-hours" name="estimated_hours" type="number" step="0.25" min={0} placeholder="0" className="w-24" />
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Adding..." : "Add Service"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Enter COGS to auto-price at 50% gross margin + 10% buffer, or leave it blank and set a price directly.
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}
