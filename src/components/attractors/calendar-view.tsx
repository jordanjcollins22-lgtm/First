"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { colorForJobStatus } from "./attractor-colors";
import { updateEvaluationStatus } from "@/lib/actions/job-actions";
import { cn } from "@/lib/utils";
import { EVALUATION_STATUS_LABELS } from "@/lib/job-lifecycle";
import type { JobWithLocation } from "@/lib/data/jobs";
import type { EvaluationStatus } from "@/types/domain";

type Preset = "today" | "last30" | "thisQuarter" | "lastQuarter" | "custom";
type ViewMode = "month" | "week" | "list";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfQuarter(d: Date, offsetQuarters: number) {
  const q = Math.floor(d.getMonth() / 3) + offsetQuarters;
  const year = d.getFullYear() + Math.floor(q / 4);
  const month = ((q % 4) + 4) % 4;
  return new Date(year, month * 3, 1);
}

function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function startOfWeek(d: Date): Date {
  const c = startOfDay(d);
  c.setDate(c.getDate() - c.getDay());
  return c;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

/** Shown only to the evaluator this job is assigned to — walks them through
 * on-my-way -> arrived; submitting the evaluation itself (on the job page)
 * is what marks it completed. */
function EvalActionButton({ jobId, status }: { jobId: string; status: EvaluationStatus }) {
  const [isPending, startTransition] = useTransition();

  if (status === "completed") return null;

  if (status === "scheduled") {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={(e) => {
          e.stopPropagation();
          startTransition(() => {
            void updateEvaluationStatus(jobId, "on_way");
          });
        }}
      >
        On My Way
      </Button>
    );
  }

  if (status === "on_way") {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={(e) => {
          e.stopPropagation();
          startTransition(() => {
            void updateEvaluationStatus(jobId, "arrived");
          });
        }}
      >
        Arrived
      </Button>
    );
  }

  return (
    <Link
      href={`/jobs/${jobId}`}
      onClick={(e) => e.stopPropagation()}
      className="shrink-0 text-xs text-primary underline-offset-2 hover:underline"
    >
      Submit evaluation
    </Link>
  );
}

function DayCell({
  date,
  jobs,
  isCurrentMonth,
  selectedJobId,
  onSelectJob,
  compact,
}: {
  date: Date;
  jobs: JobWithLocation[];
  isCurrentMonth: boolean;
  selectedJobId: string | null;
  onSelectJob: (id: string) => void;
  compact: boolean;
}) {
  const isToday = fmt(date) === fmt(new Date());
  const visible = compact ? jobs.slice(0, 3) : jobs;
  const overflow = jobs.length - visible.length;

  return (
    <div
      className={cn(
        "flex flex-col gap-1 border border-border p-1.5",
        compact ? "min-h-[92px]" : "min-h-[240px]",
        !isCurrentMonth && "bg-muted/30"
      )}
    >
      <span
        className={cn(
          "text-xs font-medium",
          !isCurrentMonth && "text-muted-foreground/50",
          isToday && "flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
        )}
      >
        {date.getDate()}
      </span>
      <div className="flex flex-col gap-0.5">
        {visible.map((job) => (
          <button
            key={job.id}
            type="button"
            onClick={() => onSelectJob(job.id)}
            className={cn(
              "flex items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px]",
              job.id === selectedJobId ? "bg-accent" : "hover:bg-accent/50"
            )}
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: colorForJobStatus(job.status) }}
              aria-hidden
            />
            <span className="truncate">{job.property.address}</span>
          </button>
        ))}
        {overflow > 0 && <span className="px-1 text-[11px] text-muted-foreground">+{overflow} more</span>}
      </div>
    </div>
  );
}

export function CalendarView({
  jobs,
  selectedJobId,
  onSelectJob,
  currentProfileId,
}: {
  jobs: JobWithLocation[];
  selectedJobId: string | null;
  onSelectJob: (id: string | null) => void;
  currentProfileId: string | null;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [anchorDate, setAnchorDate] = useState(() => startOfDay(new Date()));
  const [preset, setPreset] = useState<Preset>("last30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const jobsByDay = useMemo(() => {
    const map = new Map<string, JobWithLocation[]>();
    for (const job of jobs) {
      if (!job.evaluation_date) continue;
      const day = job.evaluation_date.slice(0, 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(job);
    }
    return map;
  }, [jobs]);

  const { from, to } = useMemo(() => {
    const now = new Date();
    if (preset === "today") {
      const d = fmt(now);
      return { from: d, to: d };
    }
    if (preset === "last30") {
      const past = new Date(now);
      past.setDate(past.getDate() - 30);
      return { from: fmt(past), to: fmt(now) };
    }
    if (preset === "thisQuarter") {
      const start = startOfQuarter(now, 0);
      const end = startOfQuarter(now, 1);
      end.setDate(end.getDate() - 1);
      return { from: fmt(start), to: fmt(end) };
    }
    if (preset === "lastQuarter") {
      const start = startOfQuarter(now, -1);
      const end = startOfQuarter(now, 0);
      end.setDate(end.getDate() - 1);
      return { from: fmt(start), to: fmt(end) };
    }
    return { from: customFrom, to: customTo };
  }, [preset, customFrom, customTo]);

  const grouped = useMemo(() => {
    const entries = Array.from(jobsByDay.entries()).filter(([day]) => {
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });
    return entries.sort((a, b) => b[0].localeCompare(a[0]));
  }, [jobsByDay, from, to]);

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(anchorDate));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [anchorDate]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(anchorDate);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [anchorDate]);

  const PRESETS: { value: Preset; label: string }[] = [
    { value: "today", label: "Today" },
    { value: "last30", label: "Last 30 days" },
    { value: "thisQuarter", label: "This quarter" },
    { value: "lastQuarter", label: "Last quarter" },
    { value: "custom", label: "Custom" },
  ];

  const VIEW_MODES: { value: ViewMode; label: string }[] = [
    { value: "month", label: "Month" },
    { value: "week", label: "Week" },
    { value: "list", label: "List" },
  ];

  function shiftAnchor(dir: 1 | -1) {
    setAnchorDate((prev) =>
      viewMode === "month" ? new Date(prev.getFullYear(), prev.getMonth() + dir, 1) : addDays(prev, dir * 7)
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
        <div className="flex items-center gap-1 rounded-md bg-muted p-1">
          {VIEW_MODES.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => setViewMode(v.value)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                viewMode === v.value ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>

        {viewMode === "list" ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPreset(p.value)}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  preset === p.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card/60 text-muted-foreground hover:bg-accent"
                }`}
              >
                {p.label}
              </button>
            ))}
            {preset === "custom" && (
              <>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-7 rounded border border-border bg-card px-2 text-xs"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-7 rounded border border-border bg-card px-2 text-xs"
                />
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shiftAnchor(-1)}
              className="rounded-full border border-border px-2 py-1 text-xs hover:bg-accent"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setAnchorDate(startOfDay(new Date()))}
              className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-accent"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => shiftAnchor(1)}
              className="rounded-full border border-border px-2 py-1 text-xs hover:bg-accent"
            >
              ›
            </button>
            <span className="text-sm font-medium">
              {viewMode === "month"
                ? anchorDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })
                : `${weekDays[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${weekDays[6].toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {viewMode === "month" && (
          <div className="flex flex-col gap-px overflow-hidden rounded-lg border border-border bg-border">
            <div className="grid grid-cols-7 gap-px bg-border">
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className="bg-card p-1.5 text-center text-xs font-medium text-muted-foreground">
                  {label}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px bg-border">
              {monthDays.map((date) => (
                <div key={date.toISOString()} className="bg-card">
                  <DayCell
                    date={date}
                    jobs={jobsByDay.get(fmt(date)) ?? []}
                    isCurrentMonth={date.getMonth() === anchorDate.getMonth()}
                    selectedJobId={selectedJobId}
                    onSelectJob={onSelectJob}
                    compact
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {viewMode === "week" && (
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
            {weekDays.map((date) => (
              <div key={date.toISOString()} className="flex flex-col bg-card">
                <div className="bg-card p-1.5 text-center text-xs font-medium text-muted-foreground">
                  {date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
                </div>
                <DayCell
                  date={date}
                  jobs={jobsByDay.get(fmt(date)) ?? []}
                  isCurrentMonth
                  selectedJobId={selectedJobId}
                  onSelectJob={onSelectJob}
                  compact={false}
                />
              </div>
            ))}
          </div>
        )}

        {viewMode === "list" &&
          (grouped.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No evaluations scheduled in this range.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {grouped.map(([day, dayJobs]) => (
                <div key={day}>
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                    {new Date(day + "T00:00:00").toLocaleDateString(undefined, {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {dayJobs.map((job) => (
                      <div
                        key={job.id}
                        className={`flex items-center gap-2 rounded-lg border p-2 text-sm ${
                          job.id === selectedJobId ? "border-primary bg-accent" : "border-border hover:bg-accent/50"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectJob(job.id)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: colorForJobStatus(job.status) }}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{job.property.address}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {job.property.customer.name}
                            </span>
                          </span>
                        </button>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {EVALUATION_STATUS_LABELS[job.evaluation_status]}
                        </span>
                        {job.assigned_to === currentProfileId && (
                          <EvalActionButton jobId={job.id} status={job.evaluation_status} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}
