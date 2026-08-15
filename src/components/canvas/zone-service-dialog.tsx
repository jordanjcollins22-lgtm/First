"use client";

import { useMemo, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import { Camera, Check, ImagePlus, Loader2, Pencil, X } from "lucide-react";

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
import { serviceTypeById, type ServiceFieldDef } from "./service-catalog";
import type { Point, ZoneServiceData } from "./types";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import { addCustomFieldOption } from "@/lib/actions/custom-field-option-actions";
import { proposeServiceType } from "@/lib/actions/service-pricing-actions";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { AddInventoryItemForm, type CreatedInventoryItem } from "@/components/inventory/add-inventory-item-form";

function PhotoThumb({
  path,
  markerCount,
  onMark,
  onRemove,
}: {
  path: string;
  markerCount: number;
  onMark: () => void;
  onRemove: () => void;
}) {
  const supabase = createClient();
  const url = supabase.storage.from("canvas-images").getPublicUrl(path).data.publicUrl;
  return (
    <div className="relative h-16 w-16 shrink-0">
      <button type="button" onClick={onMark} className="block h-16 w-16">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="h-16 w-16 rounded-md border border-border object-cover" />
      </button>
      {markerCount > 0 && (
        <span className="absolute -bottom-1.5 -left-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground">
          {markerCount}
        </span>
      )}
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

/** Full-size photo view where the evaluator taps to drop pins on areas that
 * need attention. Points are stored as 0–1 fractions of the image so they
 * stay put no matter how the photo is later displayed. */
function PhotoMarkerEditor({
  path,
  initialMarkers,
  onDone,
}: {
  path: string;
  initialMarkers: Point[];
  onDone: (markers: Point[]) => void;
}) {
  const supabase = createClient();
  const url = supabase.storage.from("canvas-images").getPublicUrl(path).data.publicUrl;
  const [markers, setMarkers] = useState<Point[]>(initialMarkers);

  function handleTap(e: ReactMouseEvent<HTMLImageElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setMarkers((prev) => [...prev, { x, y }]);
  }

  function removeMarker(index: number) {
    setMarkers((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onDone(markers)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mark areas on this photo</DialogTitle>
          <DialogDescription>Tap the photo to drop a pin. Tap a pin to remove it.</DialogDescription>
        </DialogHeader>
        <div className="relative select-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt=""
            onClick={handleTap}
            className="w-full cursor-crosshair rounded-lg border border-border"
          />
          {markers.map((marker, index) => (
            <button
              key={index}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeMarker(index);
              }}
              style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
              className="absolute -translate-x-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-destructive text-[10px] font-bold text-white shadow-md"
            >
              {index + 1}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {markers.length === 0 ? "No pins yet" : `${markers.length} pin${markers.length === 1 ? "" : "s"}`}
          </p>
          <Button type="button" size="sm" onClick={() => onDone(markers)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
  | "materials"
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
    steps.push("materials");
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
  /** Storage prefix for uploaded zone photos — required to actually save them. */
  jobId?: string;
  catalog: CanvasCatalog;
  initialLocation: string;
  initialService: ZoneServiceData | null;
  initialLengthFt: number | null;
  initialWidthFt: number | null;
  initialAreaSqFt: number | null;
  initialPerimeterFt: number | null;
  onSave: (
    location: string,
    service: ZoneServiceData | null,
    lengthFt: number | null,
    widthFt: number | null,
    areaSqFt: number | null,
    perimeterFt: number | null
  ) => void;
  onCancel: () => void;
}

export function ZoneServiceDialog({
  open,
  zoneName,
  jobId,
  catalog,
  initialLocation,
  initialService,
  initialLengthFt,
  initialWidthFt,
  initialAreaSqFt,
  initialPerimeterFt,
  onSave,
  onCancel,
}: ZoneServiceDialogProps) {
  const [location, setLocation] = useState(initialLocation);
  const [typeId, setTypeId] = useState(initialService?.typeId ?? "");
  const [values, setValues] = useState<Record<string, string>>(initialService?.values ?? {});
  const [notes, setNotes] = useState(initialService?.notes ?? "");
  const [photos, setPhotos] = useState<string[]>(initialService?.photos ?? []);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoMarkers, setPhotoMarkers] = useState<Record<string, Point[]>>(initialService?.photoMarkers ?? {});
  // Freshly-uploaded photos wait here for a yes/no on marking, one at a time.
  const [markPromptQueue, setMarkPromptQueue] = useState<string[]>([]);
  const [markingPath, setMarkingPath] = useState<string | null>(null);
  const [itemSearch, setItemSearch] = useState("");
  const [showAddNewItem, setShowAddNewItem] = useState(false);
  const [lengthFt, setLengthFt] = useState(initialLengthFt?.toString() ?? "");
  const [widthFt, setWidthFt] = useState(initialWidthFt?.toString() ?? "");
  // Answering everything already on file would mean re-clicking through
  // questions that were already answered, so jump straight to the summary
  // for a zone that's been filled in before; walk fresh zones one at a time.
  const [stepKey, setStepKey] = useState<StepKey>(initialService ? "review" : "location");

  // Area and perimeter come from length x width. A zone measured before this
  // (length/width blank) keeps whatever was entered directly back then.
  const lengthValue = lengthFt.trim() ? Number(lengthFt) : null;
  const widthValue = widthFt.trim() ? Number(widthFt) : null;
  const derivedAreaSqFt =
    lengthValue != null && widthValue != null ? lengthValue * widthValue : initialAreaSqFt;
  const derivedPerimeterFt =
    lengthValue != null && widthValue != null ? 2 * (lengthValue + widthValue) : initialPerimeterFt;

  const serviceType = serviceTypeById(typeId);
  const activeServices = catalog.servicePricing.filter((s) => s.status === "active");
  const selectedServiceRow = catalog.servicePricing.find((s) => s.service_type_id === typeId);
  const [proposeName, setProposeName] = useState("");
  const [proposeNote, setProposeNote] = useState("");
  const [proposing, setProposing] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);

  const checklistFields = useMemo(
    () => serviceType?.fields.filter((f) => f.checklistItem) ?? [],
    [serviceType]
  );
  const otherFields = useMemo(
    () => serviceType?.fields.filter((f) => !f.checklistItem) ?? [],
    [serviceType]
  );

  // Tools come from the service's own checklist; the evaluator never picks
  // them, they just ride along with the zone for the crew's plan.
  const autoTools = catalog.tools.filter((tool) =>
    catalog.serviceTools.some((link) => link.service_type_id === typeId && link.tool_id === tool.id)
  );

  const [extraMaterials, setExtraMaterials] = useState<string[]>(initialService?.materials ?? []);
  const [materialChoices, setMaterialChoices] = useState<Record<string, { type?: string; color?: string }>>(
    initialService?.materialChoices ?? {}
  );

  // Materials the chosen service already uses, plus anything added here.
  const autoMaterials = catalog.materials.filter((material) =>
    catalog.serviceMaterialRules.some(
      (rule) => rule.service_type_id === typeId && rule.material_id === material.id
    )
  );
  const zoneMaterialNames = Array.from(
    new Set([...autoMaterials.map((m) => m.name), ...extraMaterials])
  );

  function setMaterialChoice(materialName: string, key: "type" | "color", value: string) {
    setMaterialChoices((prev) => ({
      ...prev,
      [materialName]: { ...prev[materialName], [key]: value },
    }));
  }

  /**
   * The choices a material actually offers, set on the material in Inventory,
   * plus anything typed under "Other" before. Empty means don't ask — no
   * point asking what color a bag of concrete should be.
   */
  function materialOptions(materialName: string, key: "type" | "color"): string[] {
    const material = catalog.materials.find((m) => m.name === materialName);
    const defined = (key === "type" ? material?.type_options : material?.color_options) ?? [];
    const previouslyTyped = catalog.customFieldOptions[typeId]?.[`material:${materialName}:${key}`] ?? [];
    return Array.from(new Set([...defined, ...previouslyTyped]));
  }

  /** Materials that actually have something to ask about. */
  const materialsToAsk = zoneMaterialNames.filter(
    (name) => materialOptions(name, "type").length > 0 || materialOptions(name, "color").length > 0
  );

  const steps = buildSteps(Boolean(typeId), checklistFields, otherFields, values);
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
    setExtraMaterials([]);
    setMaterialChoices({});
    const nextType = serviceTypeById(nextTypeId);
    const nextChecklist = nextType?.fields.filter((f) => f.checklistItem) ?? [];
    const nextOther = nextType?.fields.filter((f) => !f.checklistItem) ?? [];
    if (nextChecklist.length > 0) setStepKey("checklist");
    else if (nextOther.length > 0) setStepKey(`field:${nextOther[0].key}`);
    else setStepKey("materials");
  }

  async function handlePropose() {
    const trimmed = proposeName.trim();
    if (!trimmed) {
      setProposeError("Enter a service name.");
      return;
    }
    setProposeError(null);
    setProposing(true);
    try {
      const created = await proposeServiceType(trimmed, proposeNote);
      setProposeName("");
      setProposeNote("");
      handleTypeChange(created.serviceTypeId);
    } catch (err) {
      setProposeError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setProposing(false);
    }
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

  function handleAddExtraMaterial(name: string) {
    if (zoneMaterialNames.includes(name)) return;
    setExtraMaterials((prev) => [...prev, name]);
    setItemSearch("");
  }

  function handleRemoveExtraMaterial(index: number) {
    setExtraMaterials((prev) => prev.filter((_, i) => i !== index));
  }

  function handleNewItemCreated(item: CreatedInventoryItem) {
    // Tools created here still join the business's inventory; they just
    // aren't something the evaluator attaches to a zone by hand.
    if (item.kind === "material") handleAddExtraMaterial(item.name);
    setShowAddNewItem(false);
  }

  const searchResults =
    itemSearch.trim().length > 0
      ? catalog.materials
          .filter(
            (m) =>
              m.name.toLowerCase().includes(itemSearch.trim().toLowerCase()) && !zoneMaterialNames.includes(m.name)
          )
          .slice(0, 8)
          .map((m) => ({ name: m.name }))
      : [];

  async function handlePhotosChange(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    if (files.length === 0) return;

    if (!jobId) {
      setPhotoError("This job hasn't finished saving yet — wait a moment and try again.");
      return;
    }

    setPhotoError(null);
    setPhotoUploading(true);
    try {
      const supabase = createClient();
      const uploaded: string[] = [];
      for (const file of files) {
        const extension = file.name.split(".").pop() || "jpg";
        const path = `${jobId}/zone-photos/${crypto.randomUUID()}.${extension}`;
        const { error } = await supabase.storage.from("canvas-images").upload(path, file);
        if (error) throw error;
        uploaded.push(path);
      }
      setPhotos((prev) => [...prev, ...uploaded]);
      setMarkPromptQueue((prev) => [...prev, ...uploaded]);
    } catch {
      setPhotoError("Couldn't upload one or more photos — check your connection and try again.");
    } finally {
      setPhotoUploading(false);
    }
  }

  function handleRemovePhoto(index: number) {
    const path = photos[index];
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setPhotoMarkers((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    setMarkPromptQueue((prev) => prev.filter((p) => p !== path));
  }

  function dismissMarkPrompt() {
    setMarkPromptQueue((prev) => prev.slice(1));
  }

  function startMarking(path: string) {
    setMarkPromptQueue((prev) => prev.filter((p) => p !== path));
    setMarkingPath(path);
  }

  function finishMarking(markers: Point[]) {
    if (!markingPath) return;
    setPhotoMarkers((prev) => {
      if (markers.length === 0) {
        const next = { ...prev };
        delete next[markingPath];
        return next;
      }
      return { ...prev, [markingPath]: markers };
    });
    setMarkingPath(null);
  }

  function handleSave() {
    // Tools come straight from the service's checklist — the evaluator never
    // picks them, they just travel with the zone for the crew.
    const tools = autoTools.map((tool) => tool.name);

    // Drop the blank placeholder an unfilled "Other" leaves behind.
    const cleanedChoices: Record<string, { type?: string; color?: string }> = {};
    for (const [name, choice] of Object.entries(materialChoices)) {
      const entry: { type?: string; color?: string } = {};
      if (choice.type?.trim()) entry.type = choice.type.trim();
      if (choice.color?.trim()) entry.color = choice.color.trim();
      if (entry.type || entry.color) cleanedChoices[name] = entry;
    }

    const service: ZoneServiceData | null = typeId
      ? { typeId, values, notes, photos, photoMarkers, tools, materials: extraMaterials, materialChoices: cleanedChoices }
      : null;

    if (serviceType) {
      for (const field of serviceType.fields) {
        if (field.type !== "select" || values[field.key] !== "Other") continue;
        const explanation = values[`${field.key}__other`];
        if (explanation?.trim()) addCustomFieldOption(typeId, field.key, explanation).catch(() => {});
      }
    }

    // Remember anything typed under "Other" so it's a one-tap choice next time.
    if (typeId) {
      for (const [materialName, choice] of Object.entries(cleanedChoices)) {
        for (const key of ["type", "color"] as const) {
          const value = choice[key];
          if (!value || materialOptions(materialName, key).includes(value)) continue;
          addCustomFieldOption(typeId, `material:${materialName}:${key}`, value).catch(() => {});
        }
      }
    }

    onSave(location, service, lengthValue, widthValue, derivedAreaSqFt, derivedPerimeterFt);
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
      <StepShell currentIndex={currentIndex} totalSteps={steps.length} onBack={goBack} onNext={goNext} title="What are the measurements?" subtitle="Measure on site — length x width, in feet.">
        <div className="flex flex-col gap-3">
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="zone-length">Length (ft)</Label>
              <Input
                id="zone-length"
                type="number"
                step="0.1"
                min={0}
                value={lengthFt}
                onChange={(e) => setLengthFt(e.target.value)}
                autoFocus
              />
            </div>
            <span className="pb-2.5 text-muted-foreground">×</span>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="zone-width">Width (ft)</Label>
              <Input
                id="zone-width"
                type="number"
                step="0.1"
                min={0}
                value={widthFt}
                onChange={(e) => setWidthFt(e.target.value)}
              />
            </div>
          </div>
          {derivedAreaSqFt != null && derivedPerimeterFt != null && (
            <p className="text-xs text-muted-foreground">
              = {Math.round(derivedAreaSqFt).toLocaleString()} sq ft ·{" "}
              {Math.round(derivedPerimeterFt).toLocaleString()} ft perimeter
            </p>
          )}
        </div>
      </StepShell>
    );
  } else if (currentStep === "service") {
    body = (
      <StepShell currentIndex={currentIndex} totalSteps={steps.length} onBack={goBack} onNext={goNext} title="What service is getting done in this area?" subtitle="Tap Next to skip — you can save with just a location.">
        <div className="flex flex-col gap-2">
          {activeServices.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No services set up yet —{" "}
              <Link href="/admin/service-pricing" target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-primary hover:underline">
                add one
              </Link>{" "}
              or propose one below.
            </p>
          )}
          {activeServices.map((service) => (
            <button
              key={service.service_type_id}
              type="button"
              onClick={() => handleTypeChange(service.service_type_id)}
              className={cn(
                "flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                typeId === service.service_type_id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card/60 hover:bg-accent"
              )}
            >
              <span className="font-medium">{service.name}</span>
              {(service.cost != null || service.estimated_hours != null) && (
                <span className={cn("text-xs", typeId === service.service_type_id ? "text-primary-foreground/80" : "text-muted-foreground")}>
                  {service.cost != null && `$${service.cost.toFixed(2)} (${service.cost_unit})`}
                  {service.cost != null && service.estimated_hours != null && " · "}
                  {service.estimated_hours != null && `Est. ${service.estimated_hours} hrs`}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-col gap-1.5 rounded-lg border border-dashed border-border p-2.5">
          <p className="text-xs font-medium text-muted-foreground">Don&apos;t see it? Propose a new service</p>
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Service name"
              value={proposeName}
              onChange={(e) => setProposeName(e.target.value)}
              className="w-40"
            />
            <Input
              placeholder="Note for pricing (optional)"
              value={proposeNote}
              onChange={(e) => setProposeNote(e.target.value)}
              className="w-48"
            />
            <Button type="button" variant="secondary" disabled={proposing} onClick={handlePropose}>
              {proposing ? "Sending..." : "Propose"}
            </Button>
          </div>
          {proposeError && <p className="text-xs text-destructive">{proposeError}</p>}
        </div>

        {selectedServiceRow?.status === "pending" && (
          <p className="mt-2 text-xs text-amber-600">⏳ Pending pricing review — an admin needs to price this before it&apos;s final.</p>
        )}
        {selectedServiceRow?.status === "denied" && (
          <p className="mt-2 text-xs text-destructive">
            🚫 We don&apos;t offer this service — it&apos;ll show as outside our scope of work.
          </p>
        )}

        {typeId && selectedServiceRow?.status === "active" && (
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
  } else if (currentStep === "materials") {
    body = (
      <StepShell currentIndex={currentIndex} totalSteps={steps.length} onBack={goBack} onNext={goNext} title="What material would they like?" subtitle="Ask the customer their preferred type and color. Tools are handled automatically.">
        <div className="flex flex-col gap-3">
          {zoneMaterialNames.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No materials on this service yet — search below to add one for this zone.
            </p>
          ) : materialsToAsk.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing to choose — {zoneMaterialNames.join(", ")} only come one way. Add the types or colors a
              material comes in on its Inventory row if that&apos;s not right.
            </p>
          ) : null}

          {materialsToAsk.map((materialName) => {
            const extraIndex = extraMaterials.indexOf(materialName);
            return (
              <div key={materialName} className="flex flex-col gap-2 rounded-lg border border-border p-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{materialName}</p>
                  {extraIndex >= 0 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveExtraMaterial(extraIndex)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${materialName}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {(["type", "color"] as const).map((key) => {
                  const options = materialOptions(materialName, key);
                  if (options.length === 0) return null;
                  const chosen = materialChoices[materialName]?.[key] ?? "";
                  const isOther = Boolean(chosen) && !options.includes(chosen);
                  return (
                    <div key={key} className="flex flex-col gap-1">
                      <Label className="text-xs capitalize text-muted-foreground">{key}</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {options.map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setMaterialChoice(materialName, key, option)}
                            className={cn(
                              "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                              chosen === option
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-card/60 hover:bg-accent"
                            )}
                          >
                            {option}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => setMaterialChoice(materialName, key, isOther ? chosen : " ")}
                          className={cn(
                            "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                            isOther
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-card/60 hover:bg-accent"
                          )}
                        >
                          Other
                        </button>
                      </div>
                      {isOther && (
                        <Input
                          placeholder="Please specify"
                          value={chosen.trim()}
                          autoFocus
                          onChange={(e) => setMaterialChoice(materialName, key, e.target.value || " ")}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          <div className="flex flex-col gap-1.5">
            <Input
              placeholder="Search materials to add..."
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
            />
            {searchResults.length > 0 && (
              <div className="flex flex-col overflow-hidden rounded-lg border border-border">
                {searchResults.map((result) => (
                  <button
                    key={result.name}
                    type="button"
                    onClick={() => handleAddExtraMaterial(result.name)}
                    className="border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent"
                  >
                    {result.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {showAddNewItem ? (
            <AddInventoryItemForm onCreated={handleNewItemCreated} onCancel={() => setShowAddNewItem(false)} />
          ) : (
            <Button type="button" variant="secondary" onClick={() => setShowAddNewItem(true)}>
              + Add new material
            </Button>
          )}
        </div>
      </StepShell>
    );
  } else if (currentStep === "photos") {
    body = (
      <StepShell currentIndex={currentIndex} totalSteps={steps.length} onBack={goBack} onNext={goNext} title="Any photos for this zone?">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {photos.map((photo, index) => (
              <PhotoThumb
                key={photo}
                path={photo}
                markerCount={photoMarkers[photo]?.length ?? 0}
                onMark={() => startMarking(photo)}
                onRemove={() => handleRemovePhoto(index)}
              />
            ))}
            <label
              className={cn(
                "flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-muted-foreground hover:bg-accent",
                photoUploading ? "pointer-events-none opacity-60" : "cursor-pointer"
              )}
            >
              {photoUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              <span className="text-[10px]">{photoUploading ? "Uploading..." : "Take"}</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                disabled={photoUploading}
                className="hidden"
                onChange={handlePhotosChange}
              />
            </label>
            <label
              className={cn(
                "flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-muted-foreground hover:bg-accent",
                photoUploading ? "pointer-events-none opacity-60" : "cursor-pointer"
              )}
            >
              {photoUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              <span className="text-[10px]">{photoUploading ? "Uploading..." : "Upload"}</span>
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={photoUploading}
                className="hidden"
                onChange={handlePhotosChange}
              />
            </label>
          </div>
          {photoError && <p className="text-xs text-destructive">{photoError}</p>}
          <p className="text-[10px] text-muted-foreground">
            Photos already on your phone work too — no signal needed until you&apos;re back online to save.
          </p>
          {markPromptQueue.length > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
              <p className="text-xs">Mark the areas that need attention on that photo?</p>
              <div className="flex shrink-0 gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={dismissMarkPrompt}>
                  Skip
                </Button>
                <Button type="button" size="sm" onClick={() => startMarking(markPromptQueue[0])}>
                  Mark it
                </Button>
              </div>
            </div>
          )}
          {markingPath && (
            <PhotoMarkerEditor
              path={markingPath}
              initialMarkers={photoMarkers[markingPath] ?? []}
              onDone={finishMarking}
            />
          )}
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
            {lengthValue != null && widthValue != null ? (
              <p>
                {lengthValue} × {widthValue} ft
                <span className="text-xs text-muted-foreground">
                  {" "}
                  = {Math.round(lengthValue * widthValue).toLocaleString()} sq ft ·{" "}
                  {Math.round(2 * (lengthValue + widthValue)).toLocaleString()} ft perimeter
                </span>
              </p>
            ) : derivedAreaSqFt != null || derivedPerimeterFt != null ? (
              <p>
                {derivedAreaSqFt != null ? `${Math.round(derivedAreaSqFt).toLocaleString()} sq ft` : "—"} ·{" "}
                {derivedPerimeterFt != null
                  ? `${Math.round(derivedPerimeterFt).toLocaleString()} ft perimeter`
                  : "—"}
              </p>
            ) : (
              <p>—</p>
            )}
          </ReviewRow>

          <ReviewRow label="Service" onEdit={() => setStepKey("service")}>
            <p>{selectedServiceRow?.name ?? serviceType?.label ?? "None selected"}</p>
            {selectedServiceRow?.status === "pending" && (
              <p className="mt-1 text-xs text-amber-600">⏳ Pending pricing review</p>
            )}
            {selectedServiceRow?.status === "denied" && (
              <p className="mt-1 text-xs text-destructive">🚫 Outside our scope of work</p>
            )}
            {fieldLines.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                {fieldLines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </ReviewRow>

          {typeId && (
            <ReviewRow label="Materials" onEdit={() => setStepKey("materials")}>
              {zoneMaterialNames.length > 0 ? (
                <ul className="flex flex-col gap-0.5">
                  {zoneMaterialNames.map((name) => {
                    const choice = materialChoices[name];
                    const detail = [choice?.type?.trim(), choice?.color?.trim()].filter(Boolean).join(" · ");
                    return (
                      <li key={name}>
                        {name}
                        {detail && <span className="text-xs text-muted-foreground"> — {detail}</span>}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p>None yet</p>
              )}
              {autoTools.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Tools: {autoTools.map((t) => t.name).join(", ")}
                </p>
              )}
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
