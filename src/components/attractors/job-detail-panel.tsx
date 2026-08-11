"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ExternalLink, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setJobSourceAttractorWave } from "@/lib/actions/attractor-actions";
import { updateJobDates } from "@/lib/actions/job-actions";
import { pointInWaveGeometry } from "@/lib/attractor-geometry";
import { colorForAttractorType, colorForJobStatus } from "./attractor-colors";
import type { AttractorType, AttractorWave } from "@/types/domain";
import type { JobWithLocation } from "@/lib/data/jobs";

const NONE = "none";

const JOB_STATUS_LABEL: Record<string, string> = {
  estimating: "Estimating",
  quoted: "Quoted",
  approved: "Approved",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function JobDetailPanel({
  job,
  waves,
  types,
  onClose,
}: {
  job: JobWithLocation;
  waves: AttractorWave[];
  types: AttractorType[];
  onClose: () => void;
}) {
  const [sourceWaveId, setSourceWaveId] = useState(job.source_attractor_wave_id ?? NONE);
  const [evaluationDate, setEvaluationDate] = useState(job.evaluation_date ?? "");
  const [projectStartDate, setProjectStartDate] = useState(job.project_start_date ?? "");
  const [isPending, startTransition] = useTransition();

  const coveringWaves = useMemo(
    () => waves.filter((w) => pointInWaveGeometry({ lat: job.property.lat, lng: job.property.lng }, w)),
    [waves, job.property.lat, job.property.lng]
  );

  function handleSourceChange(value: string) {
    setSourceWaveId(value);
    startTransition(() => setJobSourceAttractorWave(job.id, value === NONE ? null : value));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 font-semibold">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: colorForJobStatus(job.status) }}
              aria-hidden
            />
            {job.property.customer.name}
          </p>
          <p className="text-xs text-muted-foreground">{job.property.address}</p>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="text-xs">
        <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
          {JOB_STATUS_LABEL[job.status] ?? job.status}
        </span>
      </p>

      <Link
        href={`/jobs/${job.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
      >
        Open job <ExternalLink className="h-3 w-3" />
      </Link>

      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label className="text-xs">Evaluation date</Label>
          <Input
            type="date"
            value={evaluationDate}
            onChange={(e) => setEvaluationDate(e.target.value)}
            onBlur={() => startTransition(() => updateJobDates(job.id, { evaluationDate: evaluationDate || null }))}
            className="h-9 text-sm"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label className="text-xs">Project start date</Label>
          <Input
            type="date"
            value={projectStartDate}
            onChange={(e) => setProjectStartDate(e.target.value)}
            onBlur={() => startTransition(() => updateJobDates(job.id, { projectStartDate: projectStartDate || null }))}
            className="h-9 text-sm"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Attractor Waves covering this location</Label>
        {coveringWaves.length === 0 ? (
          <p className="text-xs text-muted-foreground">None of the current waves&apos; coverage includes this address.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {coveringWaves.map((w) => (
              <span
                key={w.id}
                className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: colorForAttractorType(w.type_id) }}
                  aria-hidden
                />
                {w.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Which Attractor generated this lead?</Label>
        <Select value={sourceWaveId} onValueChange={handleSourceChange} disabled={isPending}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Unknown / not set</SelectItem>
            {waves.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name} ({types.find((t) => t.id === w.type_id)?.label ?? w.type_id})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
