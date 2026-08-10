"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { Camera, X } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SERVICE_TYPES, serviceTypeById } from "./service-catalog";
import type { ZoneServiceData } from "./types";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";

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

  const serviceType = serviceTypeById(typeId);
  const pricing = catalog.servicePricing.find((p) => p.service_type_id === typeId);

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

  function handleTypeChange(nextTypeId: string) {
    setTypeId(nextTypeId);
    setValues({});
    setExtraTools([]);
  }

  function handleFieldChange(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
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
    onSave(
      location,
      service,
      areaSqFt.trim() ? Number(areaSqFt) : null,
      perimeterFt.trim() ? Number(perimeterFt) : null
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{zoneName}</DialogTitle>
          <DialogDescription>
            Set the location, pick a service, and fill in what applies. The standard scope
            for that service is added automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="zone-location">Where is this zone located?</Label>
            <Input
              id="zone-location"
              placeholder="e.g. Front yard, near the driveway"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="zone-area">Area (sq ft)</Label>
              <Input
                id="zone-area"
                type="number"
                step="0.1"
                min={0}
                placeholder="Measure on site and enter here"
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
                placeholder="Measure on site and enter here"
                value={perimeterFt}
                onChange={(e) => setPerimeterFt(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="service-type">Service</Label>
            <Select value={typeId} onValueChange={handleTypeChange}>
              <SelectTrigger id="service-type">
                <SelectValue placeholder="Select a service" />
              </SelectTrigger>
              <SelectContent>
                {SERVICE_TYPES.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {pricing && (pricing.cost != null || pricing.estimated_hours != null) && (
              <p className="text-xs text-muted-foreground">
                {pricing.cost != null && `$${pricing.cost.toFixed(2)} (${pricing.cost_unit})`}
                {pricing.cost != null && pricing.estimated_hours != null && " · "}
                {pricing.estimated_hours != null && `Est. ${pricing.estimated_hours} hrs`}
              </p>
            )}
            {typeId && (
              <p className="text-xs text-muted-foreground">
                Need to add or fix a price?{" "}
                <Link
                  href="/admin/service-pricing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-2 hover:text-primary hover:underline"
                >
                  Set it here
                </Link>{" "}
                — materials for this job are managed on the{" "}
                <Link
                  href="/admin/materials"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-2 hover:text-primary hover:underline"
                >
                  Material Database
                </Link>
                .
              </p>
            )}
          </div>

          {serviceType ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                {serviceType.fields.map((field) => (
                  <div key={field.key} className="flex flex-col gap-2">
                    <Label htmlFor={`field-${field.key}`}>{field.label}</Label>
                    {field.type === "select" ? (
                      <>
                        <Select
                          value={values[field.key] ?? ""}
                          onValueChange={(v) => handleFieldChange(field.key, v)}
                        >
                          <SelectTrigger id={`field-${field.key}`}>
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            {field.options?.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {values[field.key] === "Other" && (
                          <Input
                            placeholder="Please explain"
                            value={values[`${field.key}__other`] ?? ""}
                            onChange={(e) => handleFieldChange(`${field.key}__other`, e.target.value)}
                          />
                        )}
                      </>
                    ) : (
                      <Input
                        id={`field-${field.key}`}
                        type={field.type === "number" ? "number" : "text"}
                        min={field.type === "number" ? 0 : undefined}
                        value={values[field.key] ?? ""}
                        onChange={(e) => handleFieldChange(field.key, e.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label>Tools (selected automatically for this service)</Label>
                  <Link
                    href="/admin/tools"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                  >
                    Don&apos;t see it? Add a tool
                  </Link>
                </div>
                {autoTools.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {autoTools.map((tool) => (
                      <span
                        key={tool.id}
                        className="flex items-center gap-1 rounded-full border border-border bg-muted px-3 py-1 text-xs"
                      >
                        <span aria-hidden>{tool.icon}</span> {tool.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No tools configured for this service yet — add some under Tools and assign
                    them to this service.
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

              <div className="flex flex-col gap-2">
                <Label>Photos</Label>
                <div className="flex flex-wrap gap-2">
                  {photos.map((photo, index) => (
                    <PhotoThumb key={index} blob={photo} onRemove={() => handleRemovePhoto(index)} />
                  ))}
                  <label className="flex h-16 w-16 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-muted-foreground hover:bg-accent">
                    <Camera className="h-4 w-4" />
                    <span className="text-[10px]">Add</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handlePhotosChange}
                    />
                  </label>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="service-notes">Notes</Label>
                <Textarea
                  id="service-notes"
                  placeholder="Anything else worth noting for this zone"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              {serviceType.autoScope && (
                <div className="rounded-md bg-muted p-3 text-xs">
                  <p className="mb-1 font-medium text-foreground">Automatically included</p>
                  <p className="text-muted-foreground">{serviceType.autoScope(values)}</p>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Select a service to fill in its details, or save with just a location.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
