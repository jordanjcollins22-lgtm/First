"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PlantTreatment, YearSettings } from "@/lib/accounting/report";
import { saveYearSettings } from "@/lib/actions/accounting-actions";

import { SELECT_CLASS } from "./category-select";

const pct = (n: number) => String(Math.round(n * 10000) / 100);

export function YearSettingsForm({ settings, recommended }: { settings: YearSettings; recommended: PlantTreatment }) {
  const [status, setStatus] = useState<{ error?: string; message?: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      action={(fd) => startTransition(async () => setStatus(await saveYearSettings(fd)))}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="tax_year" value={settings.taxYear} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Inventory on hand Jan 1 ($, line 35)" name="beginning_inventory" defaultValue={settings.beginningInventory} />
        <Field label="Inventory on hand Dec 31 ($, line 41)" name="ending_inventory" defaultValue={settings.endingInventory} hint="Count plants, stone, mulch left over. At cost." />
        <Field label="Sales tax rate on materials (%)" name="sales_tax_rate" defaultValue={pct(settings.salesTaxRate)} />
        <Field label="Plant markup (price ÷ cost)" name="plant_markup" defaultValue={settings.plantMarkup} hint="2 = you bill double what plants cost." />
        <Field label="Federal marginal bracket (%)" name="federal_marginal_rate" defaultValue={pct(settings.rates.federalMarginalRate)} />
        <Field label="State income tax rate (%)" name="state_income_rate" defaultValue={pct(settings.rates.stateIncomeRate)} />
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox name="sales_tax_paid_on_materials" defaultChecked={settings.salesTaxPaidOnMaterials} />
          Suppliers charged me sales tax on plants/materials this year
        </label>
        <label className="flex items-center gap-2">
          <Checkbox name="qbi_deduction" defaultChecked={settings.rates.qbiDeduction} />
          Take the 20% qualified business income (QBI) deduction
        </label>
      </div>

      <div className="flex max-w-md flex-col gap-1.5">
        <Label htmlFor="plant_treatment">How plants are reported this year</Label>
        <select id="plant_treatment" name="plant_treatment" className={SELECT_CLASS} defaultValue={settings.plantTreatment ?? ""}>
          <option value="">Use the recommendation (currently: {recommended === "sell" ? "sell" : "install"})</option>
          <option value="sell">Sell plants: inventory / cost of goods sold (Part III)</option>
          <option value="install">Install plants: materials used in a service (line 22)</option>
        </select>
        <p className="text-xs text-muted-foreground">
          Lock this in once you&apos;ve set up invoicing and sales tax to match. It should stay the same all year.
        </p>
      </div>

      {status?.error && <p className="text-sm text-destructive">{status.error}</p>}
      {status?.message && <p className="text-sm text-green-700">{status.message}</p>}
      <Button type="submit" disabled={isPending} className="self-start">
        {isPending ? "Saving…" : "Save & recalculate"}
      </Button>
    </form>
  );
}

function Field({ label, name, defaultValue, hint }: { label: string; name: string; defaultValue: number | string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} inputMode="decimal" defaultValue={String(defaultValue)} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
