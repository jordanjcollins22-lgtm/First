"use client";

import { useMemo, useState, useTransition } from "react";
import type { Feature, Geometry } from "geojson";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { calculateMeasurements, formatMeasurement } from "@/lib/measurement";
import type { ServiceTemplate } from "@/types/domain";

interface AssignServiceDialogProps {
  open: boolean;
  geometry: Feature<Geometry> | null;
  serviceTemplates: ServiceTemplate[];
  onConfirm: (serviceTemplateId: string) => Promise<void>;
  onCancel: () => void;
}

export function AssignServiceDialog({
  open,
  geometry,
  serviceTemplates,
  onConfirm,
  onCancel,
}: AssignServiceDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const geometryType = geometry?.geometry.type;

  const eligibleTemplates = useMemo(
    () =>
      serviceTemplates.filter(
        (t) => !geometryType || t.allowed_geometry_types.includes(geometryType as never)
      ),
    [serviceTemplates, geometryType]
  );

  const measurement = geometry ? calculateMeasurements(geometry) : null;

  function handleOpenChange(next: boolean) {
    if (!next) onCancel();
  }

  function handleConfirm() {
    if (!selectedId) return;
    startTransition(async () => {
      await onConfirm(selectedId);
      setSelectedId(null);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign a service</DialogTitle>
          <DialogDescription>
            {measurement
              ? `This area measures ${formatMeasurement(measurement)}.`
              : "Pick the service template for this work area."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {eligibleTemplates.length === 0 && (
            <p className="col-span-2 text-sm text-muted-foreground">
              No service templates support this shape type yet. Add one in Service
              Templates.
            </p>
          )}
          {eligibleTemplates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => setSelectedId(template.id)}
              className={`rounded-lg border p-4 text-left transition-colors ${
                selectedId === template.id
                  ? "border-primary bg-accent"
                  : "border-border hover:bg-accent/50"
              }`}
            >
              <p className="font-semibold">{template.name}</p>
              {template.description && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {template.description}
                </p>
              )}
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Discard shape
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedId || isPending} size="lg">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Assign & Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
