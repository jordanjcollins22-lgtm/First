"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AttractorType, AttractorWaveStatus, JobStatus } from "@/types/domain";

const WAVE_STATUSES: { value: AttractorWaveStatus; label: string }[] = [
  { value: "planned", label: "Planned" },
  { value: "ready", label: "Ready" },
  { value: "completed", label: "Completed" },
];

const JOB_STATUSES: { value: JobStatus; label: string }[] = [
  { value: "estimating", label: "Estimating" },
  { value: "quoted", label: "Quoted" },
  { value: "approved", label: "Approved" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card/60 text-muted-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}

export function FilterBar({
  types,
  typeFilter,
  onToggleType,
  onClearTypeFilter,
  statusFilter,
  onToggleStatus,
  onClearStatusFilter,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  showProjects,
  onToggleShowProjects,
  jobStatusFilter,
  onToggleJobStatus,
  onClearJobStatusFilter,
  showLocations,
  onToggleShowLocations,
}: {
  types: AttractorType[];
  typeFilter: Set<string>;
  onToggleType: (id: string) => void;
  onClearTypeFilter: () => void;
  statusFilter: Set<AttractorWaveStatus>;
  onToggleStatus: (s: AttractorWaveStatus) => void;
  onClearStatusFilter: () => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  showProjects: boolean;
  onToggleShowProjects: () => void;
  jobStatusFilter: Set<JobStatus>;
  onToggleJobStatus: (s: JobStatus) => void;
  onClearJobStatusFilter: () => void;
  showLocations: boolean;
  onToggleShowLocations: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/60 bg-card/70 p-3 shadow-lg shadow-black/5 backdrop-blur-xl backdrop-saturate-150">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Type</span>
        <Chip active={typeFilter.size === 0} onClick={onClearTypeFilter}>
          All Attractors
        </Chip>
        {types.map((t) => (
          <Chip key={t.id} active={typeFilter.has(t.id)} onClick={() => onToggleType(t.id)}>
            {t.label}
          </Chip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Wave status</span>
        <Chip active={statusFilter.size === 0} onClick={onClearStatusFilter}>
          All
        </Chip>
        {WAVE_STATUSES.map((s) => (
          <Chip key={s.value} active={statusFilter.has(s.value)} onClick={() => onToggleStatus(s.value)}>
            {s.label}
          </Chip>
        ))}

        <span className="ml-3 mr-1 text-xs font-medium text-muted-foreground">Date range</span>
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => onDateFromChange(e.target.value)}
          className="h-8 w-36 text-xs"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => onDateToChange(e.target.value)}
          className="h-8 w-36 text-xs"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Label className="mr-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <input type="checkbox" checked={showProjects} onChange={onToggleShowProjects} className="h-3.5 w-3.5" />
          Projects
        </Label>
        {showProjects && (
          <>
            <Chip active={jobStatusFilter.size === 0} onClick={onClearJobStatusFilter}>
              All statuses
            </Chip>
            {JOB_STATUSES.map((s) => (
              <Chip key={s.value} active={jobStatusFilter.has(s.value)} onClick={() => onToggleJobStatus(s.value)}>
                {s.label}
              </Chip>
            ))}
          </>
        )}

        <Label className="ml-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <input type="checkbox" checked={showLocations} onChange={onToggleShowLocations} className="h-3.5 w-3.5" />
          Locations
        </Label>
      </div>
    </div>
  );
}
