"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { addDayOff, removeDayOff, setWeeklyOff } from "@/lib/actions/availability-actions";
import type { JobWithLocation } from "@/lib/data/jobs";
import type { DayOff, EvaluationStatus, WeeklyOff } from "@/types/domain";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const STATUS_LABELS: Record<EvaluationStatus, string> = {
  scheduled: "Scheduled",
  on_way: "On the way",
  arrived: "Arrived",
  completed: "Completed",
};

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatMonth(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatDayHeader(key: string): string {
  return parseDateKey(key).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function EvaluationCalendar({
  jobs,
  currentProfileId,
  evaluatorNamesById,
  allWeeklyOff,
  allDaysOff,
  rangeStart,
  rangeEnd,
}: {
  jobs: JobWithLocation[];
  currentProfileId: string;
  evaluatorNamesById?: Record<string, string>;
  allWeeklyOff: WeeklyOff[];
  allDaysOff: DayOff[];
  rangeStart: string;
  rangeEnd: string;
}) {
  const today = new Date();
  const rangeStartMonth = new Date(parseDateKey(rangeStart).getFullYear(), parseDateKey(rangeStart).getMonth(), 1);
  const rangeEndMonth = new Date(parseDateKey(rangeEnd).getFullYear(), parseDateKey(rangeEnd).getMonth(), 1);

  const [monthCursor, setMonthCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(toDateKey(today));
  const [reasonDraft, setReasonDraft] = useState("");
  const [isPending, startTransition] = useTransition();

  const myWeeklyOff = useMemo(
    () => new Set(allWeeklyOff.filter((w) => w.profile_id === currentProfileId).map((w) => w.day_of_week)),
    [allWeeklyOff, currentProfileId]
  );

  const daysOffByDate = useMemo(() => {
    const map = new Map<string, DayOff[]>();
    for (const d of allDaysOff) {
      const list = map.get(d.date) ?? [];
      list.push(d);
      map.set(d.date, list);
    }
    return map;
  }, [allDaysOff]);

  const jobsByDate = useMemo(() => {
    const map = new Map<string, JobWithLocation[]>();
    for (const j of jobs) {
      if (!j.evaluation_date) continue;
      const key = toDateKey(new Date(j.evaluation_date));
      const list = map.get(key) ?? [];
      list.push(j);
      map.set(key, list);
    }
    return map;
  }, [jobs]);

  const firstOfMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  const daysInMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();
  const cells: (Date | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(monthCursor.getFullYear(), monthCursor.getMonth(), i + 1)),
  ];

  const canGoPrev = monthCursor > rangeStartMonth;
  const canGoNext = monthCursor < rangeEndMonth;

  const selectedJobs = jobsByDate.get(selectedDate) ?? [];
  const selectedDaysOff = daysOffByDate.get(selectedDate) ?? [];
  const myDayOff = selectedDaysOff.find((d) => d.profile_id === currentProfileId) ?? null;

  function handleMarkOff() {
    startTransition(async () => {
      await addDayOff(selectedDate, reasonDraft || null);
      setReasonDraft("");
    });
  }

  function handleRemoveOff() {
    startTransition(async () => {
      await removeDayOff(selectedDate);
    });
  }

  function toggleWeeklyOff(day: number) {
    startTransition(async () => {
      await setWeeklyOff(day, !myWeeklyOff.has(day));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="mb-2 text-sm font-semibold text-muted-foreground">Your weekly availability</p>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAY_LABELS.map((label, day) => {
            const isOff = myWeeklyOff.has(day);
            return (
              <button
                key={day}
                type="button"
                disabled={isPending}
                onClick={() => toggleWeeklyOff(day)}
                title={isOff ? "You don't normally work this day — click to mark available" : "Click to mark as a day you don't normally work"}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  isOff
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-border bg-card/60 hover:bg-accent"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-white/60 bg-card/70 p-4 shadow-lg shadow-black/5 backdrop-blur-xl backdrop-saturate-150">
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            disabled={!canGoPrev}
            onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1))}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="font-semibold">{formatMonth(monthCursor)}</p>
          <button
            type="button"
            disabled={!canGoNext}
            onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-muted-foreground">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="py-1">
              {label}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((date, i) => {
            if (!date) return <div key={`blank-${i}`} />;
            const key = toDateKey(date);
            const dayJobs = jobsByDate.get(key) ?? [];
            const dayOffs = daysOffByDate.get(key) ?? [];
            const isWeeklyOff = myWeeklyOff.has(date.getDay());
            const isSelected = key === selectedDate;
            const isToday = key === toDateKey(today);

            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedDate(key)}
                className={cn(
                  "flex min-h-16 flex-col items-start gap-0.5 rounded-lg border p-1.5 text-left transition-colors",
                  isSelected ? "border-primary bg-primary/10" : "border-border hover:bg-accent/50",
                  isWeeklyOff && !isSelected && "bg-muted/40"
                )}
              >
                <span className={cn("text-xs", isToday && "font-bold text-primary")}>{date.getDate()}</span>
                {dayJobs.length > 0 && (
                  <span className="rounded-full bg-primary/15 px-1.5 py-0 text-[9px] font-medium text-primary">
                    {dayJobs.length} eval{dayJobs.length === 1 ? "" : "s"}
                  </span>
                )}
                {dayOffs.length > 0 && (
                  <span className="rounded-full bg-destructive/10 px-1.5 py-0 text-[9px] font-medium text-destructive">
                    {dayOffs.some((d) => d.profile_id === currentProfileId)
                      ? "You're off"
                      : evaluatorNamesById
                        ? dayOffs.map((d) => evaluatorNamesById[d.profile_id] ?? "Off").join(", ")
                        : `${dayOffs.length} off`}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-white/60 bg-card/70 p-4 shadow-lg shadow-black/5 backdrop-blur-xl backdrop-saturate-150">
        <p className="font-semibold">{formatDayHeader(selectedDate)}</p>

        {selectedJobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No evaluations this day.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {selectedJobs.map((job) => (
              <Link
                key={job.id}
                href={`/jobs/${job.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5 text-sm hover:bg-accent/50"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{job.property.address}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {job.property.customer.name}
                    {evaluatorNamesById?.[job.assigned_to ?? ""] && ` · ${evaluatorNamesById[job.assigned_to ?? ""]}`}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatTime(job.evaluation_date!)} · {STATUS_LABELS[job.evaluation_status]}
                </span>
              </Link>
            ))}
          </div>
        )}

        <div className="border-t border-border pt-3">
          {myDayOff ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                You&apos;re marked off this day{myDayOff.reason && ` — ${myDayOff.reason}`}.
              </p>
              <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={handleRemoveOff}>
                Remove
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={reasonDraft}
                onChange={(e) => setReasonDraft(e.target.value)}
                placeholder="Reason (optional)"
                className="h-9 w-48"
              />
              <Button type="button" size="sm" disabled={isPending} onClick={handleMarkOff}>
                Mark this day off
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
