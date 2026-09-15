"use client";

import { useMemo, useState, useTransition, type ChangeEvent } from "react";
import { v4 as uuid } from "uuid";
import { ImageUp, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StorageLocationSelect } from "@/components/inventory/storage-location-select";
import { InventoryKindChoice } from "@/components/inventory/inventory-kind-choice";
import { KitPicker } from "@/components/tool/kit-picker";
import { createClient } from "@/lib/supabase/client";
import { createTool } from "@/lib/actions/tool-actions";
import { createMaterial } from "@/lib/actions/material-actions";
import { fetchLinkPreview } from "@/lib/actions/link-preview-actions";
import { derivedCostPerUnit } from "@/lib/pricing";
import {
  EMPTY_ANSWERS,
  fieldsFor,
  outstanding,
  problemWith,
  stepsFor,
  type StepId,
  type WizardAnswers,
} from "@/lib/inventory-wizard";
import type { InventoryGroup } from "@/lib/inventory-groups";

/**
 * One question at a time, until the row is complete.
 *
 * The long form asked everything at once, which meant the fields that get
 * skipped were always the same ones — where it is kept, when to reorder — and
 * those are the ones that make an inventory worth having. Here nothing is
 * asked that the answers so far have ruled out, and nothing load-bearing can
 * be walked past: Next does not move on until the answer is good.
 *
 * The order and the branching are in inventory-wizard.ts, tested without
 * rendering anything. This is the part that draws them.
 */
export function InventoryWizard({
  group,
  storageLocations,
  availableKits,
  open,
  onOpenChange,
  onCreated,
}: {
  group: InventoryGroup;
  storageLocations: string[];
  availableKits: number[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (item: {
    id: string;
    name: string;
    table: "material" | "tool";
    kind: "tool" | "material" | "other";
  }) => void;
}) {
  const [answers, setAnswers] = useState<WizardAnswers>(() => ({
    ...EMPTY_ANSWERS,
    kind: group === "tools" || group === "gear" ? "tool" : "material",
  }));
  const [index, setIndex] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [saving, startSaving] = useTransition();

  const steps = useMemo(() => stepsFor(answers), [answers]);
  // Clamped rather than reset: changing the kind halfway can shorten the list,
  // and being thrown back to question one for it would be maddening.
  const step = steps[Math.min(index, steps.length - 1)];

  const set = <K extends keyof WizardAnswers>(key: K, value: WizardAnswers[K]) => {
    setAnswers((current) => ({ ...current, [key]: value }));
    setProblem(null);
  };

  function next() {
    const wrong = problemWith(step.id, answers);
    if (wrong) {
      setProblem(wrong);
      return;
    }
    setProblem(null);
    setIndex((i) => Math.min(i + 1, steps.length - 1));
  }

  function back() {
    setProblem(null);
    setIndex((i) => Math.max(i - 1, 0));
  }

  function pickPhoto(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    setFile(picked);
    set("photo", picked ? URL.createObjectURL(picked) : null);
  }

  async function pullFromLink() {
    const url = answers.purchaseUrl.trim();
    if (!url) return;
    setFetching(true);
    try {
      const preview = await fetchLinkPreview(url);
      setAnswers((current) => ({
        ...current,
        name: current.name.trim() || preview.title || current.name,
        description: current.description.trim() || preview.description || current.description,
      }));
    } finally {
      setFetching(false);
    }
  }

  function save() {
    const missing = outstanding(answers);
    if (missing.length > 0) {
      setProblem(missing[0]);
      return;
    }
    if (!file) {
      setProblem("A photo is how the crew knows it on sight.");
      return;
    }

    startSaving(async () => {
      try {
        const supabase = createClient();
        const bucket = answers.kind === "tool" ? "tool-images" : "material-images";
        const path = `${uuid()}/${file.name}`;
        const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file);
        if (uploadError) {
          setProblem("Couldn't upload the photo — try again.");
          return;
        }

        const formData = new FormData();
        for (const [key, value] of Object.entries(fieldsFor(answers))) formData.set(key, value);
        formData.set("image_path", path);
        formData.set("category", categoryFor(group, answers.kind));

        const result =
          answers.kind === "tool" ? await createTool(formData) : await createMaterial(formData);

        if (!result.ok) {
          setProblem(result.message);
          return;
        }

        onCreated?.({
          id: result.id,
          name: result.name,
          table: answers.kind === "tool" ? "tool" : "material",
          kind: answers.kind,
        });

        setAnswers({ ...EMPTY_ANSWERS, kind: answers.kind });
        setFile(null);
        setIndex(0);
        onOpenChange(false);
      } catch {
        setProblem("Something went wrong — try again.");
      }
    });
  }

  const perUnit = derivedCostPerUnit(
    answers.packSize.trim() ? Number(answers.packSize) : null,
    answers.packCost.trim() ? Number(answers.packCost) : null,
    null
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing halfway starts over next time. Reopening onto question six
        // with answers you cannot see is worse than typing the first two
        // again — and it is how half-finished rows get saved.
        if (!next) {
          setAnswers({ ...EMPTY_ANSWERS, kind: answers.kind });
          setFile(null);
          setIndex(0);
          setProblem(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{step.title}</DialogTitle>
          <DialogDescription>
            {step.hint ?? `Question ${index + 1} of ${steps.length}.`}
          </DialogDescription>
        </DialogHeader>

        {/* How far along, so a long branch does not feel endless. */}
        <div className="flex gap-1">
          {steps.map((s, i) => (
            <span
              key={s.id}
              className={`h-1 flex-1 rounded-full ${i <= index ? "bg-primary" : "bg-border"}`}
            />
          ))}
        </div>

        <div className="flex flex-col gap-3 py-2">
          {renderStep(step.id)}
          {problem && <p className="text-sm text-amber-700">{problem}</p>}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="outline" size="sm" onClick={back} disabled={index === 0 || saving}>
            Back
          </Button>
          {step.id === "review" ? (
            <Button type="button" onClick={save} disabled={saving}>
              {saving ? "Adding…" : "Add to Inventory"}
            </Button>
          ) : (
            <div className="flex gap-2">
              {step.optional && (
                <Button type="button" variant="outline" size="sm" onClick={() => setIndex((i) => i + 1)}>
                  Skip
                </Button>
              )}
              <Button type="button" onClick={next} disabled={saving}>
                Next
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );

  function renderStep(id: StepId) {
    switch (id) {
      case "kind":
        return <InventoryKindChoice value={answers.kind} onChange={(v) => set("kind", v)} />;

      case "name":
        return (
          <Input
            autoFocus
            value={answers.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={answers.kind === "tool" ? "Chainsaw" : "Pea gravel"}
          />
        );

      case "ownership":
        return (
          <div className="grid grid-cols-2 gap-2">
            {(["own", "rent"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => set("ownership", option)}
                className={`rounded-lg border p-3 text-left ${
                  answers.ownership === option ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <span className="block text-sm font-medium">
                  {option === "own" ? "We own it" : "We rent it"}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {option === "own" ? "Worth a tenth of cost if we sell it" : "No resale — not ours"}
                </span>
              </button>
            ))}
          </div>
        );

      case "photo":
        return (
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
              <ImageUp className="h-5 w-5" />
              {file ? file.name : "Take or choose a photo"}
              <input type="file" accept="image/*" className="hidden" onChange={pickPhoto} />
            </label>
            {answers.photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={answers.photo} alt="" className="max-h-40 w-full rounded-lg object-contain" />
            )}
          </div>
        );

      case "unit":
        return (
          <Input
            autoFocus
            value={answers.unit}
            onChange={(e) => set("unit", e.target.value)}
            placeholder="bag, sheet, cubic yard, hour"
          />
        );

      case "cost":
        return answers.kind === "tool" ? (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">
              {answers.ownership === "rent" ? "Per day" : "What it cost"}
            </Label>
            <Input
              autoFocus
              inputMode="decimal"
              value={answers.unitCost}
              onChange={(e) => set("unitCost", e.target.value)}
              placeholder="0.00"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">A pack holds</Label>
                <Input
                  inputMode="decimal"
                  value={answers.packSize}
                  onChange={(e) => set("packSize", e.target.value)}
                  placeholder="250"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">A pack costs</Label>
                <Input
                  inputMode="decimal"
                  value={answers.packCost}
                  onChange={(e) => set("packCost", e.target.value)}
                  placeholder="30"
                />
              </div>
            </div>
            {perUnit != null && (
              <p className="text-[11px] text-muted-foreground">
                That is ${perUnit.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")} per{" "}
                {answers.unit.trim() || "unit"}.
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Or just the price of one</Label>
              <Input
                inputMode="decimal"
                value={answers.unitCost}
                onChange={(e) => set("unitCost", e.target.value)}
                placeholder="0.12"
              />
            </div>
          </div>
        );

      case "coverage":
        return (
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">One {answers.unit.trim() || "unit"} does</Label>
              <Input
                inputMode="decimal"
                value={answers.coverage}
                onChange={(e) => set("coverage", e.target.value)}
                placeholder="100"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Waste %</Label>
              <Input
                inputMode="decimal"
                value={answers.wastePct}
                onChange={(e) => set("wastePct", e.target.value)}
                placeholder="10"
              />
            </div>
          </div>
        );

      case "stock_method":
        return (
          <div className="grid grid-cols-2 gap-2">
            {(["in_stock", "order_as_needed"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => set("stockMethod", option)}
                className={`rounded-lg border p-3 text-left ${
                  answers.stockMethod === option ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <span className="block text-sm font-medium">
                  {option === "in_stock" ? "We keep it" : "We order it"}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {option === "in_stock" ? "It lives somewhere" : "Bought per job"}
                </span>
              </button>
            ))}
          </div>
        );

      case "where":
        return (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Which location</Label>
              <StorageLocationSelect
                locations={storageLocations}
                value={answers.storageLocation}
                onChange={(v) => set("storageLocation", v)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Where in the shop</Label>
              <Input
                value={answers.shopLocation}
                onChange={(e) => set("shopLocation", e.target.value)}
                placeholder="Yard shelf 2"
              />
            </div>
          </div>
        );

      case "levels":
        return (
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">On hand now</Label>
              <Input
                autoFocus
                inputMode="decimal"
                value={answers.quantityOnHand}
                onChange={(e) => set("quantityOnHand", e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Reorder at</Label>
              <Input
                inputMode="decimal"
                value={answers.reorderThreshold}
                onChange={(e) => set("reorderThreshold", e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
        );

      case "kits":
        return (
          <KitPicker
            availableKits={availableKits}
            value={answers.kits}
            onChange={(v) => set("kits", v)}
          />
        );

      case "buying":
        return (
          <div className="flex flex-col gap-3">
            <div className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label className="text-xs">Purchase link</Label>
                <Input
                  inputMode="url"
                  value={answers.purchaseUrl}
                  onChange={(e) => set("purchaseUrl", e.target.value)}
                  placeholder="https://..."
                />
              </div>
              <Button type="button" variant="outline" size="sm" onClick={pullFromLink} disabled={fetching}>
                <Search className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                rows={3}
                value={answers.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Filled in from the link, or type your own"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={answers.isDelivered}
                onChange={(e) => set("isDelivered", e.target.checked)}
                className="h-4 w-4"
              />
              They deliver it to us
            </label>
          </div>
        );

      case "review": {
        const missing = outstanding(answers);
        return (
          <div className="flex flex-col gap-2">
            <dl className="flex flex-col gap-1 text-sm">
              {summaryOf(answers).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {missing.length > 0 && (
              <div className="rounded-lg border border-amber-400/70 bg-amber-50/60 p-2">
                <p className="text-xs font-medium text-amber-800">Still missing</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {missing.map((item) => (
                    <li key={item} className="text-[11px] text-amber-800">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      }

      default:
        return null;
    }
  }
}

/** Which list it lands on. Separate from what it is: a tool bought out of the
 * marketing budget is still a tool. */
function categoryFor(group: InventoryGroup, kind: "tool" | "material" | "other"): string {
  if (kind === "tool") return group === "gear" ? "gear" : "tool";
  return group === "marketing" ? "marketing" : "job";
}

/** The answers as a person would read them back. */
function summaryOf(answers: WizardAnswers): [string, string][] {
  const rows: [string, string][] = [
    ["What", answers.kind === "other" ? "A cost" : answers.kind === "tool" ? "Tool" : "Material"],
    ["Name", answers.name.trim() || "—"],
  ];

  if (answers.kind === "tool") rows.push(["Ownership", answers.ownership === "rent" ? "Rented" : "Owned"]);
  else rows.push(["One of it is", answers.unit.trim() || "—"]);

  const price =
    answers.packSize.trim() && answers.packCost.trim()
      ? `${answers.packCost} per ${answers.packSize}`
      : answers.unitCost.trim()
        ? answers.unitCost
        : "—";
  rows.push([answers.ownership === "rent" && answers.kind === "tool" ? "Per day" : "Cost", price]);

  if (answers.kind !== "other") {
    rows.push(["Stock", answers.stockMethod === "in_stock" ? "Kept in stock" : "Ordered as needed"]);
    if (answers.stockMethod === "in_stock") {
      rows.push(["Kept at", answers.storageLocation.trim() || "—"]);
      rows.push(["On hand", answers.quantityOnHand.trim() || "0"]);
      rows.push(["Reorder at", answers.reorderThreshold.trim() || "—"]);
    }
  }

  rows.push(["Photo", answers.photo ? "Added" : "—"]);
  return rows;
}
