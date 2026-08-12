"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { Camera, Check, Pencil, X } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SERVICE_TYPES, serviceTypeById, type ServiceFieldDef } from "./service-catalog";
import type { ZoneServiceData } from "./types";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import { addCustomFieldOption } from "@/lib/actions/custom-field-option-actions";
import { ToolImageThumb } from "@/components/tool/tool-image-thumb";
import { cn } from "@/lib/utils";

function PhotoThumb({ blob, onRemove }: { blob: Blob; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    // Object URLs must be created/revoked alongside the blob's lifecycle, so this
    // is a real external-system sync, not derivable state.
    const objectUrl = URL.createObjectURL(blob);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  if (!url) return null;
  return (
    <div className="relative h-16 w-16 shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="h-16 w-16 rounded-md border border-border object-cover" />
      <button
        type="button"
        onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 rounded-full bg-black/70 p-0.5 text-white"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function ReviewRow({
  label,
  onEdit,
  children,
}: {
  label: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        <button type="button" onClick={onEdit} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
          <Pencil className="h-3 w-3" />
          Edit
        </button>
      </div>
      {children}
    </div>
  );
}

function isChecklistChecked(values: Record<string, string>, key: string): boolean {
  return Boolean(values[key]);
}

type StepKey =
  | "location"
  | "measurements"
  | "service"
  | "checklist"
  | `detail:${string}`
  | `field:${string}`
  | "tools"
  | "photos"
  | "notes"
  | "review";

function buildSteps(
  hasService: boolean,
  checklistFields: ServiceFieldDef[],
  otherFields: ServiceFieldDef[],
  values: Record<string, string>
): StepKey[] {
  const steps: StepKey[] = ["location", "measurements", "service"];
  if (hasService) {
    if (checklistFields.length > 0) steps.push("checklist");
    for (const field of checklistFields) {
      if (isChecklistChecked(values, field.key)) steps.push(`detail:${field.key}`);
    }
    for (const field of otherFields) steps.push(`field:${field.key}`);
    steps.push("tools");
  }
  steps.push("photos", "notes", "review");
  return steps;
}

function StepShell({
  currentIndex,
  totalSteps,
  title,
  subtitle,
  children,
  nextDisabled,
  nextLabel,
  onBack,
  onNext,
}: {
  currentIndex: number;
  totalSteps: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  nextDisabled?: boolean;
  nextLabel?: string;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium text-muted-foreground">
          Step {currentIndex + 1} of {totalSteps}
        </p>
        <p className="text-base font-semibold">{title}</p>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div>{children}</div>
      <div className="flex items-center justify-between border-t border-border pt-3">
        <Button type="button" variant="ghost" onClick={onBack} disabled={currentIndex === 0}>
          Back
        </Button>
        <Button type="button" onClick={onNext} disabled={nextDisabled}>
          {nextLabel ?? "Next"}
        </Button>
      </div>
    </div>
  );
}

function OptionButtons({
  options,
  value,
  onChange,
  onAdvance,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  onAdvance: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => {
            onChange(option);
            if (option !== "Other") onAdvance();
          }}
          className={cn(
            "rounded-lg border px-3 py-2 text-sm transition-colors",
            value === option
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card/60 hover:bg-accent"
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

interface ZoneServiceDialogProps {
  open: boolean;
  zoneName: string;
  catalog: CanvasCatalog;
  initialLocation: string;
  initialService: ZoneServiceData | null;
  initialAreaSqFt: number | null;
  initialPerimeterFt: number | null;
  onSave: (
    location: string,
    service: ZoneServiceData | null,
    areaSqFt: number | null,
    perimeterFt: number | null
  ) => void;
  onCancel: () => void;
}

export function ZoneServiceDialog({
  open,
  zoneName,
  catalog,
  initialLocation,
  initialService,
  initialAreaSqFt,
  initialPerimeterFt,
  onSave,
  onCancel,
}: ZoneServiceDialogProps) {
  const [location, setLocation] = useState(initialLocation);
  const [typeId, setTypeId] = useState(initialService?.typeId ?? "");
  const [values, setValues] = useState<Record<string, string>>(initialService?.values ?? {});
  const [notes, setNotes] = useState(initialService?.notes ?? "");
  const [photos, setPhotos] = useState<Blob[]>(initialService?.photos ?? []);
  const [customTool, setCustomTool] = useState("");
  const [areaSqFt, setAreaSqFt] = useState(initialAreaSqFt?.toString() ?? "");
  const [perimeterFt, setPerimeterFt] = useState(initialPerimeterFt?.toString() ?? "");
  // Answering everything already on file would mean re-clicking through
  // questions that were already answered, so jump straight to the summary
  // for a zone that's been filled in before; walk fresh zones one at a time.
  const [stepKey, setStepKey] = useState<StepKey>(initialService ? "review" : "location");

  const serviceType = serviceTypeById(typeId);

  const checklistFields = useMemo(
    () => serviceType?.fields.filter((f) => f.checklistItem) ?? [],
    [serviceType]
  );
  const otherFields = useMemo(
    () => serviceType?.fields.filter((f) => !f.checklistItem) ?? [],
    [serviceType]
  );

  const autoTools = catalog.tools.filter((tool) =>
    catalog.serviceTools.some((link) => link.service_type_id === typeId && link.tool_id === tool.id)
  );
  const autoToolNames = new Set(autoTools.map((tool) => tool.name));

  const [extraTools, setExtraTools] = useState<string[]>(() => {
    if (!initialService) return [];
    const initialAutoNames = new Set(
      catalog.tools
        .filter((tool) =>
          catalog.serviceTools.some(
            (link) => link.service_type_id === initialService.typeId && link.tool_id === tool.id
          )
        )
        .map((tool) => tool.name)
    );
    return initialService.tools.filter((name) => !initialAutoNames.has(name));
  });

  const steps = buildSteps(Boolean(serviceType), checklistFields, otherFields, values);
  const currentIndex = Math.max(0, steps.indexOf(stepKey));
  const currentStep = steps[currentIndex] ?? "location";

  function goNext() {
    const idx = steps.indexOf(stepKey);
    setStepKey(steps[idx + 1] ?? "review");
  }

  function goBack() {
    const idx = steps.indexOf(stepKey);
    setStepKey(steps[Math.max(idx - 1, 0)] ?? "location");
  }

  function handleTypeChange(nextTypeId: string) {
    setTypeId(nextTypeId);
    setValues({});
    setExtraTools([]);
    const nextType = serviceTypeById(nextTypeId);
    const nextChecklist = nextType?.fields.filter((f) => f.checklistItem) ?? [];
    const nextOther = nextType?.fields.filter((f) => !f.checklistItem) ?? [];
    if (nextChecklist.length > 0) setStepKey("checklist");
    else if (nextOther.length > 0) setStepKey(`field:${nextOther[0].key}`);
    else if (nextType) setStepKey("tools");
    else setStepKey("photos");
  }

  function handleFieldChange(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function toggleChecklistItem(field: ServiceFieldDef, checked: boolean) {
    setValues((prev) => {
      const next = { ...prev };
      if (checked) {
        next[field.key] = field.options?.find((o) => o !== "None" && o !== "Other") ?? "Yes";
      } else {
        delete next[field.key];
        delete next[`${field.key}__qty`];
      }
      return next;
    });
  }

  function handleAddCustomTool() {
    const trimmed = customTool.trim();
    if (!trimmed || autoToolNames.has(trimmed) || extraTools.includes(trimmed)) return;
    setExtraTools((prev) => [...prev, trimmed]);
    setCustomTool("");
  }

  function handleRemoveExtraTool(index: number) {
    setExtraTools((prev) => prev.filter((_, i) => i !== index));
  }

  function handlePhotosChange(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files.length > 0) {
      setPhotos((prev) => [...prev, ...Array.from(files)]);
    }
    e.target.value = "";
  }

  function handleRemovePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSave() {
    const tools = [...autoTools.map((tool) => tool.name), ...extraTools];
    const service: ZoneServiceData | null = typeId ? { typeId, values, notes, photos, tools } : null;

    if (serviceType) {
      for (const field of serviceType.fields) {
        if (field.type !== "select" || values[field.key] !== "Other") continue;
        const explanation = values[`${field.key}__other`];
        if (explanation?.trim()) addCustomFieldOption(typeId, field.key, explanation).catch(() => {});
      }
    }

    onSave(
      location,
      service,
      areaSqFt.trim() ? Number(areaSqFt) : null,
      perimeterFt.trim() ? Number(perimeterFt) : null
    );
  }

  function fieldOptionsFor(field: ServiceFieldDef): string[] {
    if (!field.options) return [];
    const customOptions = (catalog.customFieldOptions[typeId]?.[field.key] ?? []).filter(
      (option) => !field.options?.includes(option)
    );
    return [...field.options.filter((o) => o !== "Other"), ...customOptions, "Other"];
  }

  function displayValue(field: ServiceFieldDef): string {
    if (field.checklistItem) {
      if (!isChecklistChecked(values, field.key)) return "";
      const qty = values[`${field.key}__qty`];
      return qty ? `${field.checklistItem.question} — Qty: ${qty}` : field.checklistItem.question;
    }
    const value = values[field.key];
    if (!value) return "";
    if (value === "Other") {
      const explanation = values[`${field.key}__other`];
      return explanation ? `${field.label}: Other — ${explanation}` : `${field.label}: Other`;
    }
    return `${field.label}: ${value}`;
  }

  let body: React.ReactNode;

  if (currentStep === "location") {
    body = (
      <StepShell currentIndex={currentIndex} totalSteps={steps.length} onBack={goBack} onNext={goNext} title="Where is this zone located?" subtitle={zoneName}>
        <Input
          placeholder="e.g. Front yard, near the driveway"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          autoFocus
        />
      </StepShell>
    );
  } else if (currentStep === "measurements") {
    body = (
      <StepShell currentIndex={currentIndex} totalSteps={steps.length} onBack={goBack} onNext={goNext} title="What are the measurements?" subtitle="Measure on site and enter here.">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="zone-area">Area (sq ft)</Label>
            <Input
              id="zone-area"
              type="number"
              step="0.1"
              min={0}
              value={areaSqFt}
              onChange={(e) => setAreaSqFt(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="zone-perimeter">Perimeter (ft)</Label>
            <Input
              id="zone-perimeter"
              type="number"
              step="0.1"
              min={0}
              value={perimeterFt}
              onChange={(e) => setPerimeterFt(e.target.value)}
            />
          </div>
        </div>
      </StepShell>
    );
  } else if (currentStep === "service") {
    body = (
      <StepShell currentIndex={currentIndex} totalSteps={steps.length} onBack={goBack} onNext={goNext} title="What service is getting done in this area?" subtitle="Tap Next to skip — you can save with just a location.">
        <div className="flex flex-col gap-2">
          {SERVICE_TYPES.map((type) => {
            const typePricing = catalog.servicePricing.find((p) => p.service_type_id === type.id);
            return (
              <button
                key={type.id}
                type="button"
                onClick={() => handleTypeChange(type.id)}
                className={cn(
                  "flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  typeId === type.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card/60 hover:bg-accent"
                )}
              >
                <span className="font-medium">{type.label}</span>
                {typePricing && (typePricing.cost != null || typePricing.estimated_hours != null) && (
                  <span className={cn("text-xs", typeId === type.id ? "text-primary-foreground/80" : "text-muted-foreground")}>
                    {typePricing.cost != null && `$${typePricing.cost.toFixed(2)} (${typePricing.cost_unit})`}
                    {typePricing.cost != null && typePricing.estimated_hours != null && " · "}
                    {typePricing.estimated_hours != null && `Est. ${typePricing.estimated_hours} hrs`}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {typeId && (
          <p className="mt-2 text-xs text-muted-foreground">
            Need to add or fix a price?{" "}
            <Link href="/admin/service-pricing" target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-primary hover:underline">
              Set it here
            </Link>
            .
          </p>
        )}
      </StepShell>
    );
  } else if (currentStep === "checklist") {
    body = (
      <StepShell currentIndex={currentIndex} totalSteps={steps.length} onBack={goBack} onNext={goNext} title="What would they like done in this area?" subtitle="Check everything that applies.">
        <div className="flex flex-col gap-2">
          {checklistFields.map((field) => {
            const checked = isChecklistChecked(values, field.key);
            return (
              <label
                key={field.key}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                  checked ? "border-primary bg-primary/10" : "border-border bg-card/60 hover:bg-accent"
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                    checked ? "border-primary bg-primary text-primary-foreground" : "border-border"
                  )}
                >
                  {checked && <Check className="h-3.5 w-3.5" />}
                </span>
                <input
                  type="checkbox"
                  className="hidden"
                  checked={checked}
                  onChange={(e) => toggleChecklistItem(field, e.target.checked)}
                />
                {field.checklistItem?.question}
              </label>
            );
          })}
        </div>
      </StepShell>
    );
  } else if (currentStep.startsWith("detail:")) {
    const key = currentStep.slice("detail:".length);
    const field = checklistFields.find((f) => f.key === key);
    body = field ? (
      <StepShell currentIndex={currentIndex} totalSteps={steps.length} onBack={goBack} onNext={goNext} title={`${field.checklistItem?.question} — how many ${field.checklistItem?.unit}?`}>
        <Input
          type="number"
          min={0}
          placeholder="How many?"
          value={values[`${field.key}__qty`] ?? ""}
          onChange={(e) => handleFieldChange(`${field.key}__qty`, e.target.value)}
          autoFocus
        />
      </StepShell>
    ) : null;
  } else if (currentStep.startsWith("field:")) {
    const key = currentStep.slice("field:".length);
    const field = otherFields.find((f) => f.key === key);
    body = field ? (
      <StepShell currentIndex={currentIndex} totalSteps={steps.length} onBack={goBack} onNext={goNext} title={`${field.label}?`}>
        {field.type === "select" ? (
          <div className="flex flex-col gap-2">
            <OptionButtons
              options={fieldOptionsFor(field)}
              value={values[field.key] ?? ""}
              onChange={(v) => handleFieldChange(field.key, v)}
              onAdvance={goNext}
            />
            {values[field.key] === "Other" && (
              <Input
                placeholder="Please explain"
                value={values[`${field.key}__other`] ?? ""}
                onChange={(e) => handleFieldChange(`${field.key}__other`, e.target.value)}
                autoFocus
              />
            )}
          </div>
        ) : (
          <Input
            type={field.type === "number" ? "number" : "text"}
            min={field.type === "number" ? 0 : undefined}
            value={values[field.key] ?? ""}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            autoFocus
          />
        )}
      </StepShell>
    ) : null;
  } else if (currentStep === "tools") {
    body = (
      <StepShell currentIndex={currentIndex} totalSteps={steps.length} onBack={goBack} onNext={goNext} title="Tools for this zone" subtitle="Selected automatically for this service — add more if needed.">
        <div className="flex flex-col gap-2">
          {autoTools.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {autoTools.map((tool) => (
                <span
                  key={tool.id}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-muted py-1 pl-1 pr-3 text-xs"
                >
                  <span className="h-5 w-5 shrink-0 overflow-hidden rounded-full">
                    <ToolImageThumb imagePath={tool.image_path} icon={tool.icon} />
                  </span>
                  {tool.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No tools configured for this service yet —{" "}
              <Link href="/admin/tools" target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-primary hover:underline">
                add some
              </Link>
              .
            </p>
          )}
          {extraTools.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {extraTools.map((tool, index) => (
                <span
                  key={index}
                  className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs text-primary"
                >
                  {tool}
                  <button type="button" onClick={() => handleRemoveExtraTool(index)}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Input
              placeholder="Add an extra tool for this zone only"
              value={customTool}
              onChange={(e) => setCustomTool(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddCustomTool();
                }
              }}
            />
            <Button type="button" variant="secondary" onClick={handleAddCustomTool}>
              Add
            </Button>
          </div>
        </div>
      </StepShell>
    );
  } else if (currentStep === "photos") {
    body = (
      <StepShell currentIndex={currentIndex} totalSteps={steps.length} onBack={goBack} onNext={goNext} title="Any photos for this zone?">
        <div className="flex flex-wrap gap-2">
          {photos.map((photo, index) => (
            <PhotoThumb key={index} blob={photo} onRemove={() => handleRemovePhoto(index)} />
          ))}
          <label className="flex h-16 w-16 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-muted-foreground hover:bg-accent">
            <Camera className="h-4 w-4" />
            <span className="text-[10px]">Add</span>
            <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotosChange} />
          </label>
        </div>
      </StepShell>
    );
  } else if (currentStep === "notes") {
    body = (
      <StepShell currentIndex={currentIndex} totalSteps={steps.length} onBack={goBack} onNext={goNext} title="Anything else worth noting?" nextLabel="Review">
        <Textarea
          placeholder="Anything else worth noting for this zone"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          autoFocus
        />
      </StepShell>
    );
  } else {
    const fieldLines = serviceType?.fields.map(displayValue).filter(Boolean) ?? [];
    body = (
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Review</p>
          <p className="text-base font-semibold">Everything look right?</p>
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <ReviewRow label="Location" onEdit={() => setStepKey("location")}>
            <p>{location || "—"}</p>
          </ReviewRow>

          <ReviewRow label="Measurements" onEdit={() => setStepKey("measurements")}>
            <p>
              {areaSqFt ? `${areaSqFt} sq ft` : "—"} · {perimeterFt ? `${perimeterFt} ft perimeter` : "—"}
            </p>
          </ReviewRow>

          <ReviewRow label="Service" onEdit={() => setStepKey("service")}>
            <p>{serviceType?.label ?? "None selected"}</p>
            {fieldLines.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                {fieldLines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </ReviewRow>

          {serviceType && (
            <ReviewRow label="Tools" onEdit={() => setStepKey("tools")}>
              <p>
                {[...autoTools.map((t) => t.name), ...extraTools].join(", ") || "None yet"}
              </p>
            </ReviewRow>
          )}

          <ReviewRow label="Photos" onEdit={() => setStepKey("photos")}>
            <p>{photos.length > 0 ? `${photos.length} attached` : "No photos yet"}</p>
          </ReviewRow>

          <ReviewRow label="Notes" onEdit={() => setStepKey("notes")}>
            <p>{notes.trim() || "None yet"}</p>
          </ReviewRow>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button type="button" variant="ghost" onClick={goBack} disabled={currentIndex === 0}>
            Back
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave}>
              Save
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader className="sr-only">
          <DialogTitle>{zoneName}</DialogTitle>
          <DialogDescription>Answer a few quick questions about this zone.</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
