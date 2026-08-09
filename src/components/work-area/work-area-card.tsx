"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Lock,
  MapPin,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PhotoUploader } from "@/components/photo/photo-uploader";
import { ScopeView } from "@/components/scope/scope-view";
import { formatMeasurement } from "@/lib/measurement";
import type { ServiceTemplate } from "@/types/domain";
import type { WorkAreaWithPhotos } from "@/lib/data/jobs";

interface WorkAreaCardProps {
  workArea: WorkAreaWithPhotos;
  serviceTemplates: ServiceTemplate[];
  zoneName: string | null;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onCleanUp: () => void;
  onChanged: () => void;
  onServiceChange: (templateId: string) => void;
  onDelete: () => void;
  onLock: () => void;
}

export function WorkAreaCard({
  workArea,
  serviceTemplates,
  zoneName,
  selected,
  busy,
  onSelect,
  onCleanUp,
  onChanged,
  onServiceChange,
  onDelete,
  onLock,
}: WorkAreaCardProps) {
  const [expanded, setExpanded] = useState(false);

  const template = serviceTemplates.find((t) => t.id === workArea.service_template_id);
  const measurement = workArea.calculated_measurements;

  const eligibleTemplates = serviceTemplates.filter((t) =>
    t.allowed_geometry_types.includes(workArea.geometry.geometry.type as never)
  );

  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        selected ? "border-primary bg-accent/40" : "border-border bg-card"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-start justify-between gap-2 text-left"
      >
        <div>
          <p className="flex items-center gap-1.5 font-semibold">
            <MapPin className="h-4 w-4 text-primary" />
            {template?.name ?? "Unassigned service"}
            {workArea.geometry_locked_at && (
              <Lock className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {measurement ? formatMeasurement(measurement) : "No measurement yet"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {zoneName && <Badge variant="secondary">{zoneName}</Badge>}
          {workArea.sequence_order != null && (
            <Badge variant="outline">#{workArea.sequence_order + 1}</Badge>
          )}
        </div>
      </button>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 flex items-center gap-1 text-xs font-medium text-muted-foreground"
      >
        {expanded ? (
          <>
            <ChevronUp className="h-3.5 w-3.5" /> Hide details
          </>
        ) : (
          <>
            <ChevronDown className="h-3.5 w-3.5" /> Details, photos & scope
          </>
        )}
      </button>

      {expanded && (
        <div className="mt-3 flex flex-col gap-4 border-t border-border pt-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Service template
            </label>
            <Select
              value={workArea.service_template_id}
              onValueChange={onServiceChange}
              disabled={busy}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {eligibleTemplates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <PhotoUploader
            workAreaId={workArea.id}
            photos={workArea.photos}
            requiredCount={template?.required_photo_count ?? 0}
            onChanged={onChanged}
          />

          {template && measurement && (
            <ScopeView template={template} measurements={measurement} />
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onCleanUp}
              disabled={busy}
            >
              <Sparkles className="h-3.5 w-3.5" /> Clean Up Shape
            </Button>
            {!workArea.geometry_locked_at && (
              <Button type="button" size="sm" variant="outline" onClick={onLock} disabled={busy}>
                <Lock className="h-3.5 w-3.5" /> Lock (price sent)
              </Button>
            )}
            <Button type="button" size="sm" variant="destructive" onClick={onDelete} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
