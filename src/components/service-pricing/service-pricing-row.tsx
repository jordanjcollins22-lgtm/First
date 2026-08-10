"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateServicePricing } from "@/lib/actions/service-pricing-actions";

interface ServicePricingRowProps {
  serviceTypeId: string;
  label: string;
  initialCost: number | null;
  initialCostUnit: string;
  initialEstimatedHours: number | null;
}

export function ServicePricingRow({
  serviceTypeId,
  label,
  initialCost,
  initialCostUnit,
  initialEstimatedHours,
}: ServicePricingRowProps) {
  const [cost, setCost] = useState(initialCost?.toString() ?? "");
  const [costUnit, setCostUnit] = useState(initialCostUnit);
  const [hours, setHours] = useState(initialEstimatedHours?.toString() ?? "");
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(() =>
      updateServicePricing(
        serviceTypeId,
        cost.trim() ? Number(cost) : null,
        costUnit,
        hours.trim() ? Number(hours) : null
      )
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border py-3 last:border-0">
      <div className="min-w-40 flex-1">
        <p className="font-medium">{label}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Cost</Label>
        <Input
          type="number"
          step="0.01"
          min={0}
          placeholder="0.00"
          value={cost}
          disabled={isPending}
          onChange={(e) => setCost(e.target.value)}
          onBlur={save}
          className="h-9 w-24 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Unit</Label>
        <Input
          placeholder="flat rate"
          value={costUnit}
          disabled={isPending}
          onChange={(e) => setCostUnit(e.target.value)}
          onBlur={save}
          className="h-9 w-32 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Est. hours</Label>
        <Input
          type="number"
          step="0.25"
          min={0}
          placeholder="0"
          value={hours}
          disabled={isPending}
          onChange={(e) => setHours(e.target.value)}
          onBlur={save}
          className="h-9 w-24 text-sm"
        />
      </div>
    </div>
  );
}
