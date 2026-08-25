"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AttractorType, AttractorWaveStatus, JobStatus } from "@/types/domain";

const ALL = "all";

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
  onStatusChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  showLeads,
  leadCount,
  onToggleShowLeads,
  showProjects,
  onToggleShowProjects,
  jobStatusFilter,
  onJobStatusChange,
  showLocations,
  onToggleShowLocations,
}: {
  types: AttractorType[];
  typeFilter: Set<string>;
  onToggleType: (id: string) => void;
  onClearTypeFilter: () => void;
  statusFilter: Set<AttractorWaveStatus>;
  onStatusChange: (status: AttractorWaveStatus | null) => void;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  /** Addresses we hold with no work on them — every imported contact, in
   * practice. Off by default: a few thousand would bury the real jobs. */
  showLeads: boolean;
  leadCount: number;
  onToggleShowLeads: () => void;
  showProjects: boolean;
  onToggleShowProjects: () => void;
  jobStatusFilter: Set<JobStatus>;
  onJobStatusChange: (status: JobStatus | null) => void;
  showLocations: boolean;
  onToggleShowLocations: () => void;
}) {
  const currentStatus = statusFilter.size === 1 ? [...statusFilter][0] : ALL;
  const currentJobStatus = jobStatusFilter.size === 1 ? [...jobStatusFilter][0] : ALL;

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

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Wave status</span>
        <Select value={currentStatus} onValueChange={(v) => onStatusChange(v === ALL ? null : (v as AttractorWaveStatus))}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All</SelectItem>
            {WAVE_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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

      <div className="flex flex-wrap items-center gap-2">
        <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <input type="checkbox" checked={showProjects} onChange={onToggleShowProjects} className="h-3.5 w-3.5" />
          Projects
        </Label>

        {/* The count is in the label because zero is the interesting case: it
            means the addresses are imported but nobody has placed them yet,
            and the answer is on the Contacts page rather than here. */}
        <Label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <input type="checkbox" checked={showLeads} onChange={onToggleShowLeads} className="h-3.5 w-3.5" />
          Leads with an address ({leadCount.toLocaleString()})
        </Label>
        {showProjects && (
          <Select
            value={currentJobStatus}
            onValueChange={(v) => onJobStatusChange(v === ALL ? null : (v as JobStatus))}
          >
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {JOB_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Label className="ml-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <input type="checkbox" checked={showLocations} onChange={onToggleShowLocations} className="h-3.5 w-3.5" />
          Locations
        </Label>
      </div>
    </div>
  );
}
