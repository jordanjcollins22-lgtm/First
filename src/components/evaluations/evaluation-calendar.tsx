"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { addDayOff, removeDayOff } from "@/lib/actions/availability-actions";
import { WeeklyAvailabilityEditor } from "@/components/evaluations/weekly-availability";
import type { JobWithLocation } from "@/lib/data/jobs";
import {
  evaluationEvents,
  eventsByDate,
  jobWorkEvents,
  LAYER_COLORS,
  LAYER_LABELS,
  type CalendarLayer,
} from "@/lib/calendar-events";
import { CalendarMap } from "@/components/evaluations/calendar-map";
import type { DayOff, WeeklyAvailability } from "@/types/domain";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
  scheduledJobs,
  workSessions,
  currentProfileId,
  evaluatorNamesById,
  allWeeklyAvailability,
  allDaysOff,
  rangeStart,
  rangeEnd,
}: {
  jobs: JobWithLocation[];
  /** Jobs with work days — the second layer on the same grid. */
  scheduledJobs: JobWithLocation[];
  workSessions: Map<string, { starts_on: string; ends_on: string; status: string }[]>;
  currentProfileId: string;
  evaluatorNamesById?: Record<string, string>;
  allWeeklyAvailability: WeeklyAvailability[];
  allDaysOff: DayOff[];
  rangeStart: string;
  rangeEnd: string;
}) {
  const today = new Date();
  const rangeStartDate = parseDateKey(rangeStart);
  const rangeEndDate = parseDateKey(rangeEnd);

  const [activeLayers, setActiveLayers] = useState<Record<CalendarLayer, boolean>>({
    evaluations: true,
    jobs: true,
  });
  const [viewMode, setViewMode] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const [selectedDate, setSelectedDate] = useState(toDateKey(today));
  const [reasonDraft, setReasonDraft] = useState("");
  const [startTimeDraft, setStartTimeDraft] = useState("");
  const [endTimeDraft, setEndTimeDraft] = useState("");
  const [isPending, startTransition] = useTransition();

  const myAvailability = useMemo(
    () => allWeeklyAvailability.filter((w) => w.profile_id === currentProfileId),
    [allWeeklyAvailability, currentProfileId]
  );
  const myAvailableDays = useMemo(() => new Set(myAvailability.map((w) => w.day_of_week)), [myAvailability]);
  const hasSetUpAvailability = myAvailability.length > 0;

  const daysOffByDate = useMemo(() => {
    const map = new Map<string, DayOff[]>();
    for (const d of allDaysOff) {
      const list = map.get(d.date) ?? [];
      list.push(d);
      map.set(d.date, list);
    }
    return map;
  }, [allDaysOff]);

  // Both calendars are one overlay: the checkboxes decide what's on the grid,
  // the day list, and the map at the same time, so there's never a version of
  // the schedule that's only true in one of the three.
  const allEvents = useMemo(
    () => [...evaluationEvents(jobs), ...jobWorkEvents(scheduledJobs, workSessions)],
    [jobs, scheduledJobs, workSessions]
  );

  const visibleEvents = useMemo(
    () => allEvents.filter((e) => activeLayers[e.layer]),
    [allEvents, activeLayers]
  );

  const eventsForDate = useMemo(() => eventsByDate(visibleEvents), [visibleEvents]);

  const layerCounts = useMemo(
    () => ({
      evaluations: allEvents.filter((e) => e.layer === "evaluations").length,
      jobs: allEvents.filter((e) => e.layer === "jobs").length,
    }),
    [allEvents]
  );

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

  const selectedEvents = eventsForDate.get(selectedDate) ?? [];
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

  return (
    <div className="flex flex-col gap-6">
      <WeeklyAvailabilityEditor myAvailability={myAvailability} />

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

        {/* One overlay, two layers. Unchecking hides a layer everywhere at
            once — grid, day list, and map — rather than per view. */}
        <div className="flex flex-wrap items-center gap-4">
          {(["evaluations", "jobs"] as const).map((layer) => (
            <label key={layer} className="flex cursor-pointer items-center gap-1.5 text-xs font-medium">
              <input
                type="checkbox"
                checked={activeLayers[layer]}
                onChange={() => setActiveLayers((prev) => ({ ...prev, [layer]: !prev[layer] }))}
                className="h-3.5 w-3.5 cursor-pointer accent-primary"
              />
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: LAYER_COLORS[layer] }}
                aria-hidden
              />
              {LAYER_LABELS[layer]}
              <span className="text-muted-foreground">({layerCounts[layer]})</span>
            </label>
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
                const dayEvents = eventsForDate.get(key) ?? [];
                const dayOffs = daysOffByDate.get(key) ?? [];
                const mine = dayOffs.find((d) => d.profile_id === currentProfileId);
                const isWeeklyOff = hasSetUpAvailability && !myAvailableDays.has(date.getDay());
                const isSelected = key === selectedDate;
                const isToday = key === toDateKey(today);

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedDate(key)}
                    className={cn(
                      "relative flex min-h-16 flex-col items-start gap-0.5 rounded-lg border p-1.5 text-left transition-colors",
                      isSelected ? "border-primary bg-primary/10" : "border-border hover:bg-accent/50",
                      // Not a working day at all, and nothing booked — mute the
                      // whole cell so non-working days read at a glance across
                      // the month rather than needing to be read one by one.
                      isWeeklyOff && !isSelected && "border-dashed bg-muted/70",
                      dayOffs.length > 0 && !isSelected && "border-destructive/40 bg-destructive/5"
                    )}
                  >
                    <span
                      className={cn(
                        "text-xs",
                        isToday && "font-bold text-primary",
                        isWeeklyOff && !isToday && "text-muted-foreground"
                      )}
                    >
                      {date.getDate()}
                    </span>
                    {/* One count per active layer, coloured to match, so a day
                        with both reads as two chips rather than one total. */}
                    {(["evaluations", "jobs"] as const)
                      .filter((layer) => dayEvents.some((e) => e.layer === layer))
                      .map((layer) => {
                        const count = dayEvents.filter((e) => e.layer === layer).length;
                        return (
                          <span
                            key={layer}
                            className="max-w-full truncate rounded-full px-1.5 py-0 text-[9px] font-medium"
                            style={{ backgroundColor: `${LAYER_COLORS[layer]}26`, color: LAYER_COLORS[layer] }}
                          >
                            {count} {layer === "evaluations" ? "eval" : "job"}
                            {count === 1 ? "" : "s"}
                          </span>
                        );
                      })}
                    {dayOffs.length > 0 ? (
                      <span className="max-w-full truncate rounded-full bg-destructive/10 px-1.5 py-0 text-[9px] font-medium text-destructive">
                        {mine
                          ? offSummary(mine)
                          : evaluatorNamesById
                            ? dayOffs.map((d) => evaluatorNamesById[d.profile_id] ?? "Off").join(", ")
                            : `${dayOffs.length} off`}
                      </span>
                    ) : (
                      isWeeklyOff && (
                        <span className="max-w-full truncate rounded-full bg-muted-foreground/15 px-1.5 py-0 text-[9px] font-medium text-muted-foreground">
                          Not working
                        </span>
                      )
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="h-3 w-3 rounded border border-dashed border-border bg-muted/70" />
                Not a working day
              </span>
              <span className="flex items-center gap-1">
                <span className="h-3 w-3 rounded border border-destructive/40 bg-destructive/5" />
                Time off
              </span>
              {(["evaluations", "jobs"] as const).map((layer) => (
                <span key={layer} className="flex items-center gap-1">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: `${LAYER_COLORS[layer]}40` }}
                  />
                  {LAYER_LABELS[layer]}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-7">
            {weekCells.map((date) => {
              const key = toDateKey(date);
              const dayEvents = eventsForDate.get(key) ?? [];
              const dayOffs = daysOffByDate.get(key) ?? [];
              const mine = dayOffs.find((d) => d.profile_id === currentProfileId);
              const isWeeklyOff = hasSetUpAvailability && !myAvailableDays.has(date.getDay());
              const isSelected = key === selectedDate;
              const isToday = key === toDateKey(today);

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDate(key)}
                  className={cn(
                    "flex min-h-14 flex-col items-stretch gap-1 rounded-lg border p-2 text-left align-top transition-colors sm:min-h-40 sm:p-1.5",
                    isSelected ? "border-primary bg-primary/10" : "border-border hover:bg-accent/50",
                    isWeeklyOff && !isSelected && "border-dashed bg-muted/70",
                    dayOffs.length > 0 && !isSelected && "border-destructive/40 bg-destructive/5"
                  )}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] font-medium text-muted-foreground">{WEEKDAY_LABELS[date.getDay()]}</span>
                    <span className={cn("text-xs", isToday && "font-bold text-primary")}>{date.getDate()}</span>
                  </div>
                  {isWeeklyOff && dayOffs.length === 0 && (
                    <span className="rounded bg-muted-foreground/15 px-1 py-0.5 text-[9px] font-medium text-muted-foreground">
                      Not working
                    </span>
                  )}
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
                  {dayEvents.map((event) => (
                    <span
                      key={event.id}
                      className="truncate rounded px-1 py-0.5 text-[9px] font-medium"
                      style={{ backgroundColor: `${LAYER_COLORS[event.layer]}1a`, color: LAYER_COLORS[event.layer] }}
                    >
                      {event.at ? `${formatTime(event.at)} ` : ""}
                      {event.address}
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

        <CalendarMap events={selectedEvents} dayLabel={formatDayHeader(selectedDate)} />

        {selectedEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing scheduled this day.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {selectedEvents.map((event) => (
              <Link
                key={event.id}
                href={`/jobs/${event.jobId}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5 text-sm hover:bg-accent/50"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: LAYER_COLORS[event.layer] }}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{event.address}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {event.customerName}
                      {evaluatorNamesById?.[event.assignedTo ?? ""] &&
                        ` · ${evaluatorNamesById[event.assignedTo ?? ""]}`}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {event.at ? `${formatTime(event.at)} · ` : ""}
                  {event.detail}
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
