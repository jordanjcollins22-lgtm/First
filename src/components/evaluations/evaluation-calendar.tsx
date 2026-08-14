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

function formatShortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDayHeader(key: string): string {
  return parseDateKey(key).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Postgres `time` comes back as "HH:MM:SS" — render it like "9:00 AM". */
function formatTimeOfDay(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Compact form for tight calendar cells, e.g. "9a" or "2:30p". */
function formatTimeCompact(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "p" : "a";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, "0")}${period}`;
}

function startOfWeek(d: Date): Date {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function offSummary(off: DayOff): string {
  if (off.start_time && off.end_time) return `Off ${formatTimeCompact(off.start_time)}–${formatTimeCompact(off.end_time)}`;
  return "Off all day";
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
  const rangeStartDate = parseDateKey(rangeStart);
  const rangeEndDate = parseDateKey(rangeEnd);

  const [viewMode, setViewMode] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const [selectedDate, setSelectedDate] = useState(toDateKey(today));
  const [reasonDraft, setReasonDraft] = useState("");
  const [startTimeDraft, setStartTimeDraft] = useState("");
  const [endTimeDraft, setEndTimeDraft] = useState("");
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
    for (const list of map.values()) list.sort((a, b) => a.evaluation_date!.localeCompare(b.evaluation_date!));
    return map;
  }, [jobs]);

  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const weekStart = startOfWeek(cursor);

  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const leadingBlanks = monthStart.getDay();
  const monthCells: (Date | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(monthStart.getFullYear(), monthStart.getMonth(), i + 1)),
  ];
  const weekCells: Date[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const canGoPrev =
    viewMode === "month"
      ? monthStart > new Date(rangeStartDate.getFullYear(), rangeStartDate.getMonth(), 1)
      : weekStart > rangeStartDate;
  const canGoNext = viewMode === "month" ? monthStart < new Date(rangeEndDate.getFullYear(), rangeEndDate.getMonth(), 1) : weekStart < rangeEndDate;

  function goPrev() {
    setCursor(
      viewMode === "month"
        ? new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)
        : new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 7)
    );
  }
  function goNext() {
    setCursor(
      viewMode === "month"
        ? new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
        : new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7)
    );
  }

  const headerLabel =
    viewMode === "month"
      ? formatMonth(monthStart)
      : `${formatShortDate(weekStart)} – ${formatShortDate(weekCells[6])}`;

  const selectedJobs = jobsByDate.get(selectedDate) ?? [];
  const selectedDaysOff = daysOffByDate.get(selectedDate) ?? [];
  const myDayOff = selectedDaysOff.find((d) => d.profile_id === currentProfileId) ?? null;
  const timesMismatched = Boolean(startTimeDraft) !== Boolean(endTimeDraft);

  function handleMarkOff() {
    startTransition(async () => {
      await addDayOff(selectedDate, reasonDraft || null, startTimeDraft || null, endTimeDraft || null);
      setReasonDraft("");
      setStartTimeDraft("");
      setEndTimeDraft("");
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
        <p className="mb-1 text-sm font-semibold text-muted-foreground">Your weekly availability</p>
        <p className="mb-2 text-xs text-muted-foreground">Set once — this is what your calendar assumes every week until you change it.</p>
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
        <div className="mb-3 flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={!canGoPrev}
            onClick={goPrev}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="font-semibold">{headerLabel}</p>
          <button
            type="button"
            disabled={!canGoNext}
            onClick={goNext}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-3 flex justify-center gap-1 rounded-lg bg-secondary/70 p-1 text-xs font-medium">
          {(["month", "week"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={cn(
                "rounded-md px-3 py-1 capitalize transition-colors",
                viewMode === mode ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {mode}
            </button>
          ))}
        </div>

        {viewMode === "month" ? (
          <>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-muted-foreground">
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className="py-1">
                  {label}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {monthCells.map((date, i) => {
                if (!date) return <div key={`blank-${i}`} />;
                const key = toDateKey(date);
                const dayJobs = jobsByDate.get(key) ?? [];
                const dayOffs = daysOffByDate.get(key) ?? [];
                const mine = dayOffs.find((d) => d.profile_id === currentProfileId);
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
                        {mine
                          ? offSummary(mine)
                          : evaluatorNamesById
                            ? dayOffs.map((d) => evaluatorNamesById[d.profile_id] ?? "Off").join(", ")
                            : `${dayOffs.length} off`}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-7 gap-1.5">
            {weekCells.map((date) => {
              const key = toDateKey(date);
              const dayJobs = jobsByDate.get(key) ?? [];
              const dayOffs = daysOffByDate.get(key) ?? [];
              const mine = dayOffs.find((d) => d.profile_id === currentProfileId);
              const isWeeklyOff = myWeeklyOff.has(date.getDay());
              const isSelected = key === selectedDate;
              const isToday = key === toDateKey(today);

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDate(key)}
                  className={cn(
                    "flex min-h-40 flex-col items-stretch gap-1 rounded-lg border p-1.5 text-left align-top transition-colors",
                    isSelected ? "border-primary bg-primary/10" : "border-border hover:bg-accent/50",
                    isWeeklyOff && !isSelected && "bg-muted/40"
                  )}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] font-medium text-muted-foreground">{WEEKDAY_LABELS[date.getDay()]}</span>
                    <span className={cn("text-xs", isToday && "font-bold text-primary")}>{date.getDate()}</span>
                  </div>
                  {mine && (
                    <span className="rounded bg-destructive/10 px-1 py-0.5 text-[9px] font-medium text-destructive">
                      {offSummary(mine)}
                    </span>
                  )}
                  {dayOffs
                    .filter((d) => d.profile_id !== currentProfileId)
                    .map((d) => (
                      <span key={d.id} className="truncate rounded bg-destructive/10 px-1 py-0.5 text-[9px] font-medium text-destructive">
                        {evaluatorNamesById?.[d.profile_id] ?? "Off"} · {offSummary(d)}
                      </span>
                    ))}
                  {dayJobs.map((job) => (
                    <span key={job.id} className="truncate rounded bg-primary/10 px-1 py-0.5 text-[9px] font-medium text-primary">
                      {formatTime(job.evaluation_date!)} {job.property.address}
                    </span>
                  ))}
                </button>
              );
            })}
          </div>
        )}
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
                {myDayOff.start_time && myDayOff.end_time
                  ? `You're off ${formatTimeOfDay(myDayOff.start_time)}–${formatTimeOfDay(myDayOff.end_time)} this day`
                  : "You're off all day"}
                {myDayOff.reason && ` — ${myDayOff.reason}`}.
              </p>
              <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={handleRemoveOff}>
                Remove
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={reasonDraft}
                  onChange={(e) => setReasonDraft(e.target.value)}
                  placeholder="Reason (optional)"
                  className="h-9 w-40"
                />
                <Input
                  type="time"
                  value={startTimeDraft}
                  onChange={(e) => setStartTimeDraft(e.target.value)}
                  className="h-9 w-28"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <Input
                  type="time"
                  value={endTimeDraft}
                  onChange={(e) => setEndTimeDraft(e.target.value)}
                  className="h-9 w-28"
                />
                <Button type="button" size="sm" disabled={isPending || timesMismatched} onClick={handleMarkOff}>
                  Mark off
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Leave both times blank to mark the whole day off.</p>
              {timesMismatched && <p className="text-xs text-destructive">Set both a start and end time, or leave both blank.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
