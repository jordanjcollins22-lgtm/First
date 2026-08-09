"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { createClient } from "@/lib/supabase/client";
import { formatMeasurement } from "@/lib/measurement";
import { generateScope } from "@/lib/scope-generation";
import type { JobWithProperty, WorkAreaWithPhotos } from "@/lib/data/jobs";
import type { ServiceTemplate, Zone } from "@/types/domain";

interface CrewPreviewProps {
  job: JobWithProperty;
  zones: Zone[];
  workAreas: WorkAreaWithPhotos[];
  serviceTemplates: ServiceTemplate[];
}

export function CrewPreview({ job, zones, workAreas, serviceTemplates }: CrewPreviewProps) {
  const zoneById = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones]);

  const ordered = useMemo(() => {
    return [...workAreas].sort((a, b) => {
      const zoneA = a.zone_id ? zoneById.get(a.zone_id)?.sequence_order ?? 999 : 999;
      const zoneB = b.zone_id ? zoneById.get(b.zone_id)?.sequence_order ?? 999 : 999;
      if (zoneA !== zoneB) return zoneA - zoneB;
      return (a.sequence_order ?? 999) - (b.sequence_order ?? 999);
    });
  }, [workAreas, zoneById]);

  const [index, setIndex] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  if (ordered.length === 0) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10 text-center">
        <p className="text-muted-foreground">
          No work areas yet for this job. Draw some in the estimator first.
        </p>
        <Button asChild className="mt-4">
          <Link href={`/jobs/${job.id}`}>Back to Estimator</Link>
        </Button>
      </div>
    );
  }

  const workArea = ordered[index];
  const template = serviceTemplates.find((t) => t.id === workArea.service_template_id);
  const zone = workArea.zone_id ? zoneById.get(workArea.zone_id) : null;
  const scope = template && workArea.calculated_measurements
    ? generateScope(workArea.id, template, workArea.calculated_measurements)
    : null;

  const supabase = createClient();
  const photoUrl = (path: string) =>
    supabase.storage.from("work-area-photos").getPublicUrl(path).data.publicUrl;

  function toggleStep(step: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      const key = `${workArea.id}:${step}`;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <Link href={`/jobs/${job.id}`} className="text-sm text-muted-foreground">
          &larr; Back to estimator
        </Link>
        <p className="text-sm font-medium">
          Area {index + 1} of {ordered.length}
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div>
            {zone && (
              <p className="flex items-center gap-1 text-sm font-semibold text-primary">
                <MapPin className="h-4 w-4" /> {zone.name}
              </p>
            )}
            <h1 className="text-2xl font-bold">{template?.name ?? "Unassigned"}</h1>
            <p className="text-muted-foreground">
              {workArea.calculated_measurements
                ? formatMeasurement(workArea.calculated_measurements)
                : "No measurement"}
            </p>
          </div>

          {workArea.photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {workArea.photos.map((photo) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={photo.id}
                  src={photoUrl(photo.storage_path)}
                  alt=""
                  className="aspect-square rounded-md object-cover"
                />
              ))}
            </div>
          )}

          {template && (
            <>
              {(template.tools_required.length > 0 || template.equipment_required.length > 0) && (
                <div className="rounded-md bg-muted p-3 text-sm">
                  {template.tools_required.length > 0 && (
                    <p>
                      <span className="font-semibold">Tools: </span>
                      {template.tools_required.join(", ")}
                    </p>
                  )}
                  {template.equipment_required.length > 0 && (
                    <p>
                      <span className="font-semibold">Equipment: </span>
                      {template.equipment_required.join(", ")}
                    </p>
                  )}
                </div>
              )}

              {scope && scope.materials.length > 0 && (
                <div className="rounded-md bg-muted p-3 text-sm">
                  <p className="font-semibold">Materials</p>
                  <ul className="mt-1 list-inside list-disc">
                    {scope.materials.map((m) => (
                      <li key={m.material}>
                        {m.material}: {m.quantity} {m.unit}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <p className="mb-2 font-semibold">Checklist</p>
                <div className="flex flex-col gap-2">
                  {template.crew_steps.map((step) => {
                    const key = `${workArea.id}:${step}`;
                    const isChecked = checked.has(key);
                    return (
                      <button
                        key={step}
                        type="button"
                        onClick={() => toggleStep(step)}
                        className="flex items-center gap-3 rounded-md border border-border p-3 text-left"
                      >
                        <Checkbox checked={isChecked} onCheckedChange={() => toggleStep(step)} />
                        <span className={isChecked ? "text-muted-foreground line-through" : ""}>
                          {step}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {template.quality_control_requirements.length > 0 && (
                <div className="rounded-md border border-primary/30 bg-accent/40 p-3 text-sm">
                  <p className="flex items-center gap-1 font-semibold text-primary">
                    <CheckCircle2 className="h-4 w-4" /> Quality Control
                  </p>
                  <ul className="mt-1 list-inside list-disc">
                    {template.quality_control_requirements.map((qc, i) => (
                      <li key={i}>{qc}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button
          type="button"
          size="xl"
          variant="outline"
          className="flex-1"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          <ArrowLeft className="h-5 w-5" /> Previous
        </Button>
        <Button
          type="button"
          size="xl"
          className="flex-1"
          disabled={index === ordered.length - 1}
          onClick={() => setIndex((i) => Math.min(ordered.length - 1, i + 1))}
        >
          Next Area <ArrowRight className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
