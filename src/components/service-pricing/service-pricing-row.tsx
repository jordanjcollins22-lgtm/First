"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  updateServicePricing,
  updateServiceCogs,
  updateServiceMinutesPerSqft,
} from "@/lib/actions/service-pricing-actions";
import { linkMaterialToService, deleteServiceMaterialRule } from "@/lib/actions/material-actions";
import { priceFromCogs, materialsCostPerSqFt, laborCostPerSqFt } from "@/lib/pricing";
import type { Material, ServiceMaterialRule } from "@/types/domain";

interface ServicePricingRowProps {
  serviceTypeId: string;
  label: string;
  initialCogs: number | null;
  initialCost: number | null;
  initialCostUnit: string;
  initialEstimatedHours: number | null;
  initialMinutesPerSqft: number | null;
  materials: Material[];
  materialRules: ServiceMaterialRule[];
  crewCostPerHour: number | null;
}

export function ServicePricingRow({
  serviceTypeId,
  label,
  initialCogs,
  initialCost,
  initialCostUnit,
  initialEstimatedHours,
  initialMinutesPerSqft,
  materials,
  materialRules,
  crewCostPerHour,
}: ServicePricingRowProps) {
  const [cogs, setCogs] = useState(initialCogs?.toString() ?? "");
  const [cost, setCost] = useState(initialCost?.toString() ?? "");
  const [costUnit, setCostUnit] = useState(initialCostUnit);
  const [hours, setHours] = useState(initialEstimatedHours?.toString() ?? "");
  const [minutesPerSqft, setMinutesPerSqft] = useState(initialMinutesPerSqft?.toString() ?? "");
  const [showCalculator, setShowCalculator] = useState(false);
  const [materialSearch, setMaterialSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  const linkedRules = materialRules
    .filter((r) => r.service_type_id === serviceTypeId)
    .map((r) => ({ rule: r, material: materials.find((m) => m.id === r.material_id) }))
    .filter((x): x is { rule: ServiceMaterialRule; material: Material } => Boolean(x.material));
  const linkedMaterialIds = new Set(linkedRules.map((x) => x.material.id));
  const materialResults =
    materialSearch.trim().length > 0
      ? materials
          .filter((m) => !linkedMaterialIds.has(m.id) && m.name.toLowerCase().includes(materialSearch.trim().toLowerCase()))
          .slice(0, 6)
      : [];
  const materialsPerSqFt = materialsCostPerSqFt(serviceTypeId, materialRules, materials);
  const minutesValue = minutesPerSqft.trim() ? Number(minutesPerSqft) : 0;
  const laborPerSqFt = crewCostPerHour != null ? laborCostPerSqFt(minutesValue, crewCostPerHour) : 0;
  const calculatedCogsPerSqFt = materialsPerSqFt + laborPerSqFt;

  function saveCogs(nextCogs: string, unit?: string) {
    const parsed = nextCogs.trim() ? Number(nextCogs) : null;
    if (parsed != null) setCost(priceFromCogs(parsed).toString());
    if (unit) setCostUnit(unit);
    startTransition(() => updateServiceCogs(serviceTypeId, parsed, unit));
  }

  function savePricing() {
    startTransition(() =>
      updateServicePricing(
        serviceTypeId,
        cost.trim() ? Number(cost) : null,
        costUnit,
        hours.trim() ? Number(hours) : null
      )
    );
  }

  function handleUseCalculated() {
    const rounded = Math.round(calculatedCogsPerSqFt * 100) / 100;
    setCogs(rounded.toString());
    saveCogs(rounded.toString(), "per sq ft");
    startTransition(() => updateServiceMinutesPerSqft(serviceTypeId, minutesValue || null));
  }

  function handleAddMaterial(materialId: string) {
    setMaterialSearch("");
    startTransition(() => linkMaterialToService(serviceTypeId, materialId));
  }

  function handleRemoveMaterial(ruleId: string) {
    startTransition(() => deleteServiceMaterialRule(ruleId));
  }

  return (
    <div className="border-b border-border py-3 last:border-0">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40 flex-1">
          <p className="font-medium">{label}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">COGS</Label>
          <Input
            type="number"
            step="0.01"
            min={0}
            placeholder="0.00"
            value={cogs}
            disabled={isPending}
            onChange={(e) => setCogs(e.target.value)}
            onBlur={() => saveCogs(cogs)}
            className="h-9 w-24 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Price {cogs.trim() && "(auto)"}</Label>
          <Input
            type="number"
            step="0.01"
            min={0}
            placeholder="0.00"
            value={cost}
            disabled={isPending}
            onChange={(e) => setCost(e.target.value)}
            onBlur={savePricing}
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
            onBlur={savePricing}
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
            onBlur={savePricing}
            className="h-9 w-24 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowCalculator((v) => !v)}
          className="flex items-center gap-1 pb-2 text-xs text-muted-foreground hover:text-primary"
        >
          {showCalculator ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Calculate from materials &amp; time
        </button>
      </div>

      {showCalculator && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Materials this service uses (pick as many as needed):</p>
            {linkedRules.length > 0 ? (
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {linkedRules.map(({ rule, material }) => (
                  <li
                    key={rule.id}
                    className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs"
                  >
                    {material.name}
                    {material.cost_per_unit != null && material.coverage_per_unit_sqft
                      ? ` — $${((material.cost_per_unit / material.coverage_per_unit_sqft) * (1 + material.waste_factor_pct / 100)).toFixed(2)}/sq ft`
                      : " — no cost/coverage set"}
                    <button type="button" onClick={() => handleRemoveMaterial(rule.id)} disabled={isPending}>
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">None yet.</p>
            )}
            <div className="mt-1.5 flex flex-col gap-1">
              <Input
                placeholder="Search materials to add..."
                value={materialSearch}
                onChange={(e) => setMaterialSearch(e.target.value)}
                className="h-9 w-56 text-sm"
              />
              {materialResults.length > 0 && (
                <div className="flex w-56 flex-col overflow-hidden rounded-lg border border-border bg-card">
                  {materialResults.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleAddMaterial(m.id)}
                      className="px-3 py-1.5 text-left text-xs hover:bg-accent"
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Minutes to do 1 sq ft</Label>
              <Input
                type="number"
                step="0.1"
                min={0}
                placeholder="0"
                value={minutesPerSqft}
                onChange={(e) => setMinutesPerSqft(e.target.value)}
                className="h-9 w-24 text-sm"
              />
            </div>
            {crewCostPerHour == null && (
              <p className="text-xs text-destructive">
                Set your crew cost per hour above first — labor cost can&apos;t be calculated without it.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>Materials: ${materialsPerSqFt.toFixed(2)}/sq ft</span>
            <span>Labor: ${laborPerSqFt.toFixed(2)}/sq ft</span>
            <span className="font-medium text-foreground">COGS: ${calculatedCogsPerSqFt.toFixed(2)}/sq ft</span>
          </div>

          <Button type="button" size="sm" disabled={isPending} onClick={handleUseCalculated} className="self-start">
            Use this as COGS
          </Button>
        </div>
      )}
    </div>
  );
}
