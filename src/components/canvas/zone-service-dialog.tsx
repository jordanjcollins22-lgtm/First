"use client";

import { MEASURED_BY, MEASURED_BY_KEY, MEASURED_FROM_MAP } from "@/lib/measured-by";
import { type ChangeEvent, type MouseEvent as ReactMouseEvent, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Camera, Check, ClipboardPaste, Eye, ImagePlus, Loader2, MessageCircle, Pencil, Trash2, X } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  extensionForImage,
  fileFromDataUrl,
  imageUrlFromHtml,
  imagesFromClipboard,
  isDataImageUrl,
  isFetchableImageUrl,
  pasteIsForTyping,
  readClipboardImages,
} from "@/lib/pasted-images";
import { Button } from "@/components/ui/button";
import { SayIt } from "@/components/ui/say-it";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fieldApplies, serviceTypeById, withoutStale, type ServiceFieldDef } from "./service-catalog";
import { KIND_LABEL, STEP_QUESTIONS, countQuestion, fieldQuestion, type Question } from "@/lib/walkthrough-questions";
import type { Point, ZoneServiceData } from "./types";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import { addCustomFieldOption } from "@/lib/actions/custom-field-option-actions";
import { proposeServiceType } from "@/lib/actions/service-pricing-actions";
import { createClient } from "@/lib/supabase/client";
import { localPreview } from "@/lib/offline/outbox";
import { sendOrKeep } from "@/lib/offline/outbox-send";
import { cn } from "@/lib/utils";
import { AddInventoryItemForm, type CreatedInventoryItem } from "@/components/inventory/add-inventory-item-form";
import {
  describeMeasurement,
  kindOfSaved,
  measurementIsSettled,
  readMeasurement,
  type MeasurementKind,
} from "@/lib/zone-measurement";
import { matchesSuggestion, suggestedLocations } from "@/lib/zone-locations";

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
  // A photo still on the phone, taken with no signal, shows from there until it uploads.
  const url = localPreview(path) ?? supabase.storage.from("canvas-images").getPublicUrl(path).data.publicUrl;
  return (
    <div className="relative h-16 w-16 shrink-0">
      <button type="button" onClick={onMark} className="block h-16 w-16">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="" className="h-16 w-16 rounded-md border border-border object-cover" />
      </button>
      {markerCount > 0 ? (
        <span className="absolute -bottom-1.5 -left-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground">
          {markerCount}
        </span>
      ) : (
        // Every photo needs a pin on the work: until it has one, it says so.
        <span className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-md bg-amber-500/90 py-0.5 text-center text-[9px] font-semibold text-white">
          Tap to pin
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
  // A photo still on the phone, taken with no signal, shows from there until it uploads.
  const url = localPreview(path) ?? supabase.storage.from("canvas-images").getPublicUrl(path).data.publicUrl;
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
          <DialogTitle>Tap the area you&apos;re working on</DialogTitle>
          <DialogDescription>
            Tap the photo at least once, on the work itself, so whoever prices it and the crew know which part of the picture it is. Tap a pin to remove it.
          </DialogDescription>
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
            {markers.length === 0 ? "Tap the photo to place a pin" : `${markers.length} pin${markers.length === 1 ? "" : "s"}`}
          </p>
          <Button type="button" size="sm" disabled={markers.length === 0} onClick={() => onDone(markers)}>
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
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        {onEdit && (
          <button type="button" onClick={onEdit} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
            <Pencil className="h-3 w-3" />
            Edit
          </button>
        )}
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
  values: Record<string, string>,
  /** On the walkthrough the place and the service are already known, so not asked. */
  knownPlaceAndService = false
): StepKey[] {
  const steps: StepKey[] = knownPlaceAndService ? ["measurements"] : ["location", "measurements", "service"];
  if (hasService) {
    if (checklistFields.length > 0) steps.push("checklist");
    for (const field of checklistFields) {
      if (isChecklistChecked(values, field.key)) steps.push(`detail:${field.key}`);
    }
    for (const field of otherFields) if (fieldApplies(field, values)) steps.push(`field:${field.key}`);
    steps.push("materials");
  }
  steps.push("photos", "notes", "review");
  return steps;
}

/**
 * The evaluator's walkthrough, where every question says who answers it
 * and an area can be taken off from any of its questions.
 */
const WalkthroughContext = createContext<{ area: string; onRemove: () => void } | null>(null);

/** Who answers the question on screen: blue for the client, amber for the evaluator. */
function WhoAnswers({ question }: { question: Question }) {
  const client = question.kind !== "check";
  return (
    <div className="flex flex-col gap-1">
      <p
        className={cn(
          "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold uppercase tracking-wide text-white",
          client ? "bg-sky-600" : "bg-amber-500"
        )}
      >
        {client ? <MessageCircle className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        {KIND_LABEL[question.kind]}
      </p>
      {question.kind === "confirm" && (
        <p className="text-center text-xs font-medium text-sky-800 dark:text-sky-300">They already picked this on their form</p>
      )}
    </div>
  );
}

function StepShell({
  currentIndex,
  totalSteps,
  title,
  subtitle,
  question,
  children,
  nextDisabled,
  nextLabel,
  hideNext,
  onBack,
  onNext,
}: {
  currentIndex: number;
  totalSteps: number;
  title: string;
  subtitle?: string;
  /** On the walkthrough: who answers, and the words to say. Replaces the title. */
  question?: Question;
  children: React.ReactNode;
  nextDisabled?: boolean;
  nextLabel?: string;
  /** When the answer buttons move on by themselves. */
  hideNext?: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const walk = useContext(WalkthroughContext);
  const said = question && question.kind !== "check";
  return (
    <div className="flex flex-col gap-4">
      {walk ? (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{walk.area}</p>
            <p className="text-xs text-muted-foreground">
              {currentIndex + 1} of {totalSteps}
            </p>
          </div>
          <button
            type="button"
            onClick={walk.onRemove}
            className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-red-300 bg-red-50 px-2.5 text-xs font-semibold text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove area
          </button>
        </div>
      ) : (
        <p className="text-xs font-medium text-muted-foreground">
          Step {currentIndex + 1} of {totalSteps}
        </p>
      )}
      {question && <WhoAnswers question={question} />}
      <div>
        <p className={question ? "text-center text-xl font-bold text-balance" : "text-base font-semibold"}>
          {question ? (said ? `\u201c${question.text}\u201d` : question.text) : title}
        </p>
        {subtitle && <p className={cn("text-sm text-muted-foreground", question && "text-center")}>{subtitle}</p>}
      </div>
      <div>{children}</div>
      <div className="flex items-center justify-between border-t border-border pt-3">
        <Button type="button" variant="ghost" onClick={onBack} disabled={currentIndex === 0}>
          Back
        </Button>
        {!hideNext && (
          <Button type="button" onClick={onNext} disabled={nextDisabled}>
            {nextLabel ?? "Next"}
          </Button>
        )}
      </div>
    </div>
  );
}

function OptionButtons({
  options,
  value,
  onChange,
  onAdvance,
  big = false,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  onAdvance: () => void;
  /** One big button a row, for a phone held in one hand in a garden. */
  big?: boolean;
}) {
  return (
    <div className={big ? "grid grid-cols-1 gap-2" : "flex flex-wrap gap-2"}>
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
            big && "min-h-14 rounded-xl border-2 text-base font-semibold",
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
  /** Trying the tool: photos are not kept, and it says so. */
  practice?: boolean;
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
    perimeterFt: number | null,
    /** Whether this was measured as a rectangle or as a run. */
    measurementKind: MeasurementKind
  ) => void;
  onCancel: () => void;
  /** Locations already used on this evaluation, for the chips. */
  otherLocations?: string[];
  /**
   * The evaluator's walkthrough: the place and service are known, each
   * question says whether it is the client's or the evaluator's, answers
   * from the client's form are read back to confirm, and the area can be
   * removed from any question.
   */
  walkthrough?: {
    /** The fields the client already answered on their pre-eval. */
    fromForm: string[];
    /** Been through before: opens on the summary rather than the first question. */
    reviewed: boolean;
    onRemove: () => void;
  };
}

export function ZoneServiceDialog({
  open,
  zoneName,
  jobId,
  practice = false,
  catalog,
  initialLocation,
  otherLocations,
  initialService,
  initialLengthFt,
  initialWidthFt,
  initialAreaSqFt,
  initialPerimeterFt,
  onSave,
  onCancel,
  walkthrough,
}: ZoneServiceDialogProps) {
  const [location, setLocation] = useState(initialLocation);
  // Worked out from what has been named so far rather than from a stored
  // list: zones get renamed and deleted, and a stored list of places would
  // keep offering one that no longer exists anywhere on the property.
  const locationSuggestions = suggestedLocations(
    (otherLocations ?? []).map((value) => ({ location: value })),
    { exclude: initialLocation }
  );
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
  // The photo on the pin screen: the one tapped, or else each new photo in
  // turn as soon as it is in, so a photo isn't finished until its work is pinned.
  const pinning = markingPath ?? (photoUploading ? null : (markPromptQueue[0] ?? null));
  // Photos with no pin on them yet: the area can't be saved until each has one.
  const unpinned = photos.filter((p) => !(photoMarkers[p]?.length));
  const [itemSearch, setItemSearch] = useState("");
  const [showAddNewItem, setShowAddNewItem] = useState(false);
  const widthInputRef = useRef<HTMLInputElement>(null);
  const [lengthFt, setLengthFt] = useState(initialLengthFt?.toString() ?? "");
  const [widthFt, setWidthFt] = useState(initialWidthFt?.toString() ?? "");
  // On site or off a map: kept apart from the answers until saving, because
  // picking the service clears those.
  const [measuredBy, setMeasuredBy] = useState(initialService?.values?.[MEASURED_BY_KEY] ?? "");
  // Answering everything already on file would mean re-clicking through
  // questions that were already answered, so jump straight to the summary
  // for a zone that's been filled in before; walk fresh zones one at a time.
  const [stepKey, setStepKey] = useState<StepKey>(
    walkthrough ? (walkthrough.reviewed ? "review" : "measurements") : initialService ? "review" : "location"
  );
  /** Confirm questions the client changed their mind on, now showing the choices. */
  const [changing, setChanging] = useState<Record<string, boolean>>({});

  // Some work is a run rather than a rectangle — weeds out of driveway
  // cracks, edging a bed — and asking for a width gets a made-up number.
  // A blank width is ambiguous though, so a length on its own is not read
  // as linear until the evaluator says it is. See lib/zone-measurement.
  const [linearConfirmed, setLinearConfirmed] = useState(
    () => kindOfSaved({ lengthFt: initialLengthFt, widthFt: initialWidthFt, areaSqFt: initialAreaSqFt }) === "linear"
  );

  const measurement = readMeasurement({ length: lengthFt, width: widthFt, linearConfirmed });

  // A zone measured before length and width were fields keeps whatever was
  // entered directly back then.
  const derivedAreaSqFt = measurement.kind === "none" ? initialAreaSqFt : measurement.areaSqFt;
  const derivedPerimeterFt =
    measurement.kind === "none" ? initialPerimeterFt : measurement.perimeterFt;

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

  // What this service usually needs. Shown as a reminder on the review step;
  // the actual load-out is chosen per zone on the job page, so nothing here
  // writes to the zone.
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

  const steps = buildSteps(Boolean(typeId), checklistFields, otherFields, values, Boolean(walkthrough && typeId));
  const currentIndex = Math.max(0, steps.indexOf(stepKey));
  const currentStep = steps[currentIndex] ?? "location";

  // Nothing to choose means nothing to ask — the materials step still exists
  // (reachable from Review, to add an extra material by hand) but the guided
  // click-through skips straight past it when no material has type/color
  // options configured.
  function goNext() {
    const idx = steps.indexOf(stepKey);
    let next = idx + 1;
    if (steps[next] === "materials" && materialsToAsk.length === 0) next += 1;
    setStepKey(steps[next] ?? "review");
  }

  function goBack() {
    const idx = steps.indexOf(stepKey);
    let prev = Math.max(idx - 1, 0);
    if (steps[prev] === "materials" && materialsToAsk.length === 0) prev = Math.max(prev - 1, 0);
    setStepKey(steps[prev] ?? "location");
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
    else {
      const nextAutoMaterials = catalog.materials.filter((material) =>
        catalog.serviceMaterialRules.some(
          (rule) => rule.service_type_id === nextTypeId && rule.material_id === material.id
        )
      );
      const nextHasOptions = nextAutoMaterials.some(
        (m) => (m.type_options?.length ?? 0) > 0 || (m.color_options?.length ?? 0) > 0
      );
      setStepKey(nextHasOptions ? "materials" : "photos");
    }
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
    setValues((prev) => withoutStale(serviceType?.fields ?? [], { ...prev, [key]: value }));
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

  /**
   * Put photographs on this zone, however they arrived.
   *
   * One path for the camera, the file picker and the clipboard, so a pasted
   * photograph is stored, named and queued for marking exactly like one that
   * came off a phone.
   */
  async function uploadPhotos(files: File[]) {
    if (files.length === 0) return;

    if (!jobId) {
      setPhotoError(
        practice
          ? "Photos are not kept in practice. On a real job, the ones taken of this area go here."
          : "This job hasn't finished saving yet, wait a moment and try again."
      );
      return;
    }

    setPhotoError(null);
    setPhotoUploading(true);
    try {
      const uploaded: string[] = [];
      let kept = 0;
      for (const file of files) {
        // A pasted screenshot has no filename at all, so the extension comes
        // from what the clipboard says it is. See lib/pasted-images.ts.
        const extension = extensionForImage(file.type, file.name);
        const path = `${jobId}/zone-photos/${crypto.randomUUID()}.${extension}`;
        // With no signal it is kept on the phone under the same path, which
        // the area keeps now; it uploads by itself later.
        const sent = await sendOrKeep({ kind: "zone-photo", scope: `site-map:${jobId}`, label: "Area photo on the site map", blob: file, type: file.type, args: { path } });
        if (sent.status === "refused") throw new Error(sent.message);
        if (sent.status === "kept") kept++;
        uploaded.push(path);
      }
      if (kept > 0) setPhotoError(`No signal: ${kept === 1 ? "that photo is" : `${kept} photos are`} saved on this phone and upload by themselves when there's signal.`);
      setPhotos((prev) => [...prev, ...uploaded]);
      setMarkPromptQueue((prev) => [...prev, ...uploaded]);
    } catch {
      setPhotoError("Couldn't upload one or more photos, check your connection and try again.");
    } finally {
      setPhotoUploading(false);
    }
  }

  /**
   * Paste a photograph straight onto the zone.
   *
   * An evaluator back at a desk already has the picture on screen: in a text
   * message, an email, a screenshot they just took. Saving it to disk and
   * hunting for it in a file picker is the long way round to a thing every
   * other application does with two keys.
   *
   * It works from anywhere in the dialog, not only the photos step, because
   * the gesture is "this picture belongs to this zone" and not "I am on the
   * right screen for it". A paste into a box somebody is typing in belongs to
   * that box and is left alone.
   */
  /**
   * The picture a copied piece of a document was pointing at.
   *
   * Copying an image out of Google Docs, a web page or an email puts the HTML
   * that held it on the clipboard and leaves the picture where it was, named
   * by address. So the clipboard says there is no picture on it while the
   * person doing the copying is looking straight at one, which is exactly what
   * this looked like from the outside.
   *
   * A picture spelled out in the address is read here. One stored on somebody
   * else's domain is fetched by our server, because the browser is not allowed
   * to. See api/paste-image.
   */
  async function imageFromHtml(html: string): Promise<File[]> {
    const url = imageUrlFromHtml(html);
    if (!url) return [];
    if (isDataImageUrl(url)) {
      const file = fileFromDataUrl(url);
      return file ? [file] : [];
    }
    if (!isFetchableImageUrl(url)) return [];
    const response = await fetch(`/api/paste-image?url=${encodeURIComponent(url)}`, { cache: "no-store" });
    if (!response.ok) return [];
    const blob = await response.blob();
    if (blob.size === 0) return [];
    return [new File([blob], `pasted.${extensionForImage(blob.type)}`, { type: blob.type })];
  }

  /** How many photographs the last paste put on, until it has been seen. */
  const [pasted, setPasted] = useState<number | null>(null);
  const pasteRef = useRef(uploadPhotos);
  const htmlRef = useRef(imageFromHtml);
  useEffect(() => {
    pasteRef.current = uploadPhotos;
    htmlRef.current = imageFromHtml;
  });
  useEffect(() => {
    if (!open) return;
    const onPaste = (event: ClipboardEvent) => {
      if (pasteIsForTyping(event.target)) return;
      const images = imagesFromClipboard(event.clipboardData);
      const html = images.length === 0 ? (event.clipboardData?.getData("text/html") ?? "") : "";
      if (images.length === 0 && !imageUrlFromHtml(html)) return;
      event.preventDefault();
      // Said, not jumped to. Moving somebody off the summary they were reading
      // to a step they then have to walk back from is a worse answer to "did
      // that work?" than telling them it worked.
      setPasted(images.length || 1);
      void (async () => {
        const files = images.length > 0 ? images : await htmlRef.current(html);
        if (files.length === 0) {
          setPasted(null);
          return;
        }
        setPasted(files.length);
        await pasteRef.current(files);
      })();
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open]);

  /**
   * The Paste button.
   *
   * The keyboard shortcut is handed a paste event with the files already on
   * it. A button has to go and ask the system clipboard, which is a different
   * browser interface: it can raise a permission prompt, and Firefox does not
   * implement it for images at all. So when asking does not work, it says
   * which keys do, because those always do.
   */
  async function handlePasteButton() {
    setPhotoError(null);
    try {
      const clipboard = navigator.clipboard as { read?: () => Promise<ClipboardItem[]> } | undefined;
      if (!clipboard?.read) {
        setPhotoError("This browser won't let a button read the clipboard. Press Ctrl+V (Cmd+V on a Mac) instead.");
        return;
      }
      const entries = await clipboard.read();
      let images = await readClipboardImages(entries);

      if (images.length === 0) {
        // Nothing image-shaped, so look for a picture the copied markup was
        // pointing at. This is the Google Docs case.
        const holder = entries.find((entry) => entry.types.includes("text/html"));
        if (holder) {
          setPhotoError(null);
          setPhotoUploading(true);
          try {
            images = await imageFromHtml(await (await holder.getType("text/html")).text());
          } finally {
            setPhotoUploading(false);
          }
        }
      }

      if (images.length === 0) {
        setPhotoError("No picture on the clipboard. Copy the image itself, then press Paste.");
        return;
      }
      setPasted(images.length);
      await uploadPhotos(images);
    } catch {
      setPhotoError("Couldn't read the clipboard. Press Ctrl+V (Cmd+V on a Mac) instead.");
    }
  }

  useEffect(() => {
    if (pasted === null || photoUploading) return;
    const timer = setTimeout(() => setPasted(null), 5000);
    return () => clearTimeout(timer);
  }, [pasted, photoUploading]);

  async function handlePhotosChange(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    await uploadPhotos(files);
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

  function startMarking(path: string) {
    setMarkPromptQueue((prev) => prev.filter((p) => p !== path));
    setMarkingPath(path);
  }

  function finishMarking(markers: Point[]) {
    const path = pinning;
    if (!path) return;
    setPhotoMarkers((prev) => {
      if (markers.length === 0) {
        const next = { ...prev };
        delete next[path];
        return next;
      }
      return { ...prev, [path]: markers };
    });
    setMarkPromptQueue((prev) => prev.filter((p) => p !== path));
    setMarkingPath(null);
  }

  function handleSave() {
    if (unpinned.length > 0) {
      setStepKey("photos");
      setPhotoError(`Tap the area you're working on in every photo first: ${unpinned.length === 1 ? "1 photo has" : `${unpinned.length} photos have`} no pin.`);
      return;
    }
    // Whatever the account manager chose on the job page, untouched. This used
    // to overwrite them with the service's whole tool list on every save,
    // which meant a zone nobody had picked tools for still arrived on the
    // crew's sheet carrying ten of them — and re-saving a zone silently wiped
    // a selection somebody had made deliberately.
    const tools = initialService?.tools ?? [];

    // Drop the blank placeholder an unfilled "Other" leaves behind.
    const cleanedChoices: Record<string, { type?: string; color?: string }> = {};
    for (const [name, choice] of Object.entries(materialChoices)) {
      const entry: { type?: string; color?: string } = {};
      if (choice.type?.trim()) entry.type = choice.type.trim();
      if (choice.color?.trim()) entry.color = choice.color.trim();
      if (entry.type || entry.color) cleanedChoices[name] = entry;
    }

    const answered = measuredBy ? { ...values, [MEASURED_BY_KEY]: measuredBy } : values;
    const service: ZoneServiceData | null = typeId
      ? { typeId, values: answered, notes, photos, photoMarkers, tools, materials: extraMaterials, materialChoices: cleanedChoices }
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

    onSave(
      location,
      service,
      measurement.lengthFt,
      measurement.widthFt,
      derivedAreaSqFt,
      derivedPerimeterFt,
      measurement.kind
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
      return qty ? `${field.checklistItem.question}, Qty: ${qty}` : field.checklistItem.question;
    }
    const value = values[field.key];
    if (!value) return "";
    if (value === "Other") {
      const explanation = values[`${field.key}__other`];
      return explanation ? `${field.label}: Other, ${explanation}` : `${field.label}: Other`;
    }
    return `${field.label}: ${value}`;
  }

  let body: React.ReactNode;
  /** The walkthrough's version of a question; nothing changes off it. */
  const asked = (question: Question) => (walkthrough ? question : undefined);

  if (currentStep === "location") {
    body = (
      <StepShell currentIndex={currentIndex} totalSteps={steps.length} onBack={goBack} onNext={goNext} title="Where is this zone located?" subtitle={zoneName}>
        <div className="flex flex-col gap-3">
          {/* The places already named on this property, tapped rather than
              retyped. An evaluation walks one garden and the same few places
              come up over and over; typing "Front yard, near the driveway" a
              fourth time on a phone is slow, and it is how one place ends up
              spelled four ways and reads as four places on the crew sheet. */}
          {locationSuggestions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground">Already on this property</p>
              <div className="flex flex-wrap gap-1.5">
                {locationSuggestions.map((suggestion) => {
                  const chosen = matchesSuggestion(location, suggestion);
                  return (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setLocation(chosen ? "" : suggestion)}
                      aria-pressed={chosen}
                      className={`min-h-9 rounded-full border px-3 text-sm font-medium ${
                        chosen
                          ? "border-transparent bg-primary text-primary-foreground"
                          : "border-border hover:bg-accent/50"
                      }`}
                    >
                      {suggestion}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <Input
            placeholder={
              locationSuggestions.length > 0
                ? "Or somewhere new"
                : "e.g. Front yard, near the driveway"
            }
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            // Not focused where there are chips to tap: a keyboard covering
            // them means the shortcut is offered and then hidden.
            autoFocus={locationSuggestions.length === 0}
          />
        </div>
      </StepShell>
    );
  } else if (currentStep === "measurements") {
    body = (
      <StepShell
        currentIndex={currentIndex}
        totalSteps={steps.length}
        onBack={goBack}
        onNext={goNext}
        // An unconfirmed length is not a measurement. Letting Next through
        // would be guessing on the evaluator's behalf about the one thing
        // this step exists to establish.
        nextDisabled={!measurementIsSettled(measurement) || (measurement.lengthFt != null && !measuredBy)}
        question={asked(STEP_QUESTIONS.measurements)}
        title="What are the measurements?"
        subtitle="Measure on site, in feet. Length only is fine for a run."
      >
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
                ref={widthInputRef}
                type="number"
                step="0.1"
                min={0}
                value={widthFt}
                onChange={(e) => {
                  setWidthFt(e.target.value);
                  // Typing a width is a change of mind, and the newer
                  // statement wins. Leaving the flag set would keep the
                  // rectangle reading as a run.
                  if (e.target.value.trim()) setLinearConfirmed(false);
                }}
              />
            </div>
          </div>
          {/* A size off the map is checked against the aerial before it is priced. */}
          {measurement.lengthFt != null && (
            <div className="flex flex-col gap-1.5">
              <Label>How did you get it?</Label>
              <div className="grid grid-cols-2 gap-2">
                {MEASURED_BY.map((how) => (
                  <Button key={how} type="button" size="sm" variant={measuredBy === how ? "default" : "outline"} onClick={() => setMeasuredBy(how)}>
                    {how}
                  </Button>
                ))}
              </div>
              {measuredBy === MEASURED_FROM_MAP && (
                <p className="text-xs text-amber-800 dark:text-amber-300">Only the part that gets the work: where the lawn stops at the trees, the beds and not the patio. It will be checked against the aerial before it is priced.</p>
              )}
            </div>
          )}
          {/* A length with no width is ambiguous: a run, or a form somebody
              is halfway through typing. The difference is a price, so it is
              asked rather than assumed. */}
          {measurement.needsConfirmation && (
            <div className="rounded-lg border border-amber-300/70 bg-amber-50/70 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                No width, is this a length only?
              </p>
              <p className="mt-0.5 text-xs text-amber-900/80 dark:text-amber-200/80">
                Like weeds out of driveway cracks, or edging: {measurement.lengthFt} linear ft, priced
                by the foot rather than the square foot.
              </p>
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" onClick={() => setLinearConfirmed(true)}>
                  Yes, length only
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => widthInputRef.current?.focus()}
                >
                  No, add a width
                </Button>
              </div>
            </div>
          )}

          {describeMeasurement(measurement) && (
            <p className="text-xs text-muted-foreground">
              {describeMeasurement(measurement)}
              {measurement.kind === "linear" && (
                <button
                  type="button"
                  onClick={() => setLinearConfirmed(false)}
                  className="ml-2 underline"
                >
                  not length only
                </button>
              )}
            </p>
          )}
        </div>
      </StepShell>
    );
  } else if (currentStep === "service") {
    body = (
      <StepShell currentIndex={currentIndex} totalSteps={steps.length} onBack={goBack} onNext={goNext} title="What service is getting done in this area?" subtitle="Tap Next to skip, you can save with just a location.">
        <div className="flex flex-col gap-2">
          {activeServices.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No services set up yet:{" "}
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
          <p className="mt-2 text-xs text-amber-600">⏳ Pending pricing review, an admin needs to price this before it&apos;s final.</p>
        )}
        {selectedServiceRow?.status === "denied" && (
          <p className="mt-2 text-xs text-destructive">
            🚫 We don&apos;t offer this service, it&apos;ll show as outside our scope of work.
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
      <StepShell currentIndex={currentIndex} totalSteps={steps.length} onBack={goBack} onNext={goNext} title="What would they like done in this area?" subtitle="Check everything that applies." question={asked(STEP_QUESTIONS.checklist)}>
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
      <StepShell currentIndex={currentIndex} totalSteps={steps.length} onBack={goBack} onNext={goNext} title={`${field.checklistItem?.question}, how many ${field.checklistItem?.unit}?`} subtitle={walkthrough ? field.checklistItem?.question : undefined} question={asked(countQuestion(field.checklistItem?.unit ?? ""))}>
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
    const question = field && walkthrough ? fieldQuestion(typeId, field, values[field.key], walkthrough.fromForm.includes(field.key)) : undefined;
    // What they picked on their form, read back: one tap if it still stands.
    const confirming = question?.kind === "confirm" && !changing[key];
    body = field ? (
      <StepShell
        currentIndex={currentIndex}
        totalSteps={steps.length}
        onBack={goBack}
        onNext={goNext}
        title={`${field.label}?`}
        question={question}
        hideNext={confirming}
      >
        {confirming ? (
          <div className="flex flex-col gap-2">
            <p className="text-center text-sm font-semibold">{values[field.key]}</p>
            <Button type="button" className="h-14 text-base font-semibold" onClick={goNext}>
              <Check className="mr-1.5 h-5 w-5" /> Yes, that&apos;s right
            </Button>
            <Button type="button" variant="outline" className="h-14 text-base font-semibold" onClick={() => setChanging((prev) => ({ ...prev, [key]: true }))}>
              No, change it
            </Button>
          </div>
        ) : field.type === "select" ? (
          <div className="flex flex-col gap-2">
            <OptionButtons
              options={fieldOptionsFor(field)}
              value={values[field.key] ?? ""}
              onChange={(v) => handleFieldChange(field.key, v)}
              onAdvance={goNext}
              big={Boolean(walkthrough)}
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
      <StepShell currentIndex={currentIndex} totalSteps={steps.length} onBack={goBack} onNext={goNext} title="What material would they like?" subtitle={walkthrough ? undefined : "Ask the customer their preferred type and color. Tools are handled automatically."} question={asked(STEP_QUESTIONS.materials)}>
        <div className="flex flex-col gap-3">
          {zoneMaterialNames.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No materials on this service yet, search below to add one for this zone.
            </p>
          ) : materialsToAsk.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing to choose: {zoneMaterialNames.join(", ")} only come one way. Add the types or colors a
              material comes in on its Inventory row if that&apos;s not right.
            </p>
          ) : null}

          {materialsToAsk.map((materialName) => {
            const extraIndex = extraMaterials.indexOf(materialName);
            return (
              <div key={materialName} className="flex flex-col gap-2 rounded-lg border border-border p-2.5">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    {materialName}
                    <SayIt text={materialName} className="h-6 w-6" />
                  </p>
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
            <AddInventoryItemForm
              onCreated={handleNewItemCreated}
              onCancel={() => setShowAddNewItem(false)}
              storageLocations={catalog.storageLocations}
            />
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
      <StepShell currentIndex={currentIndex} totalSteps={steps.length} onBack={goBack} onNext={goNext} title="Any photos for this zone?" question={asked(STEP_QUESTIONS.photos)}>
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
            {/* A button as well as the shortcut. The shortcut is faster once
                you know it is there, and nobody knows it is there. */}
            <button
              type="button"
              onClick={handlePasteButton}
              disabled={photoUploading}
              title="Paste a picture you have copied"
              className={cn(
                "flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-muted-foreground hover:bg-accent",
                photoUploading ? "pointer-events-none opacity-60" : "cursor-pointer"
              )}
            >
              {photoUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardPaste className="h-4 w-4" />}
              <span className="text-[10px]">{photoUploading ? "Uploading..." : "Paste"}</span>
            </button>
          </div>
          {photoError && <p className="text-xs text-destructive">{photoError}</p>}
          <p className="text-[10px] text-muted-foreground">
            Photos already on your phone work too, no signal needed until you&apos;re back online to save. At a
            desk, copy a picture from anywhere and press Paste, or Ctrl+V (Cmd+V on a Mac). Copying it out of
            a document works too.
          </p>
          {unpinned.length > 0 && (
            <p className="rounded-lg border border-amber-400 bg-amber-50/70 p-2.5 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              {unpinned.length === 1 ? "A photo has" : `${unpinned.length} photos have`} no pin yet. Tap {unpinned.length === 1 ? "it" : "each one"} and tap the area you&apos;re working on.
            </p>
          )}
          {pinning && <PhotoMarkerEditor key={pinning} path={pinning} initialMarkers={photoMarkers[pinning] ?? []} onDone={finishMarking} />}
        </div>
      </StepShell>
    );
  } else if (currentStep === "notes") {
    body = (
      <StepShell currentIndex={currentIndex} totalSteps={steps.length} onBack={goBack} onNext={goNext} title="Anything else worth noting?" nextLabel="Review" question={asked(STEP_QUESTIONS.notes)}>
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
          <p className="text-xs font-medium text-muted-foreground">{walkthrough ? zoneName : "Review"}</p>
          <p className="text-base font-semibold">{walkthrough ? "That's this area. Everything look right?" : "Everything look right?"}</p>
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <ReviewRow label="Location" onEdit={walkthrough ? undefined : () => setStepKey("location")}>
            <p>{location || "-"}</p>
          </ReviewRow>

          <ReviewRow label="Measurements" onEdit={() => setStepKey("measurements")}>
            {measurement.kind === "area" ? (
              <p>
                {measurement.lengthFt} × {measurement.widthFt} ft
                <span className="text-xs text-muted-foreground">
                  {" "}
                  {describeMeasurement(measurement)}
                </span>
              </p>
            ) : measurement.kind === "linear" ? (
              // Length only, and said so. Never a square-foot figure beside it.
              <p>
                {measurement.lengthFt} ft
                <span className="text-xs text-muted-foreground"> · length only, no width</span>
              </p>
            ) : derivedAreaSqFt != null || derivedPerimeterFt != null ? (
              <p>
                {derivedAreaSqFt != null ? `${Math.round(derivedAreaSqFt).toLocaleString()} sq ft` : "-"} ·{" "}
                {derivedPerimeterFt != null
                  ? `${Math.round(derivedPerimeterFt).toLocaleString()} ft perimeter`
                  : "-"}
              </p>
            ) : (
              <p>-</p>
            )}
          </ReviewRow>

          <ReviewRow label="Service" onEdit={walkthrough ? undefined : () => setStepKey("service")}>
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
                        {detail && <span className="text-xs text-muted-foreground">, {detail}</span>}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p>None yet</p>
              )}
              {autoTools.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Usually needs: {autoTools.map((t) => t.name).join(", ")}, picked per zone on the job
                  page, not here.
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
              {walkthrough ? "Done" : "Save"}
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
        <WalkthroughContext.Provider value={walkthrough ? { area: zoneName, onRemove: walkthrough.onRemove } : null}>
          {body}
        </WalkthroughContext.Provider>
        {/* A paste works from any step, so what it did has to be visible from
            any step. */}
        {pasted !== null && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-xs">
            {photoError ? (
              <span className="text-destructive">{photoError}</span>
            ) : photoUploading ? (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Adding {pasted} pasted {pasted === 1 ? "photo" : "photos"}...
              </span>
            ) : (
              <span>
                {pasted} pasted {pasted === 1 ? "photo" : "photos"} added to {zoneName}.
              </span>
            )}
            {currentStep !== "photos" && !photoUploading && (
              <button
                type="button"
                onClick={() => {
                  setPasted(null);
                  setStepKey("photos");
                }}
                className="shrink-0 font-semibold text-primary underline-offset-2 hover:underline"
              >
                Show me
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
