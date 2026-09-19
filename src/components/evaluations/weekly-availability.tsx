"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { saveWeeklyAvailability, type WeeklyAvailabilityDayInput } from "@/lib/actions/availability-actions";
import type { WeeklyAvailability } from "@/types/domain";

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DEFAULT_START = "08:00";
const DEFAULT_END = "17:00";

interface DayDraft {
  available: boolean;
  startTime: string;
  endTime: string;
}

function formatTimeOfDay(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function buildDrafts(saved: WeeklyAvailability[]): DayDraft[] {
  const byDay = new Map(saved.map((s) => [s.day_of_week, s]));
  return Array.from({ length: 7 }, (_, day) => {
    const existing = byDay.get(day);
    if (existing) return { available: true, startTime: existing.start_time.slice(0, 5), endTime: existing.end_time.slice(0, 5) };
    // First-time setup default: Mon-Fri available, weekends off — just a starting point to adjust.
    const isWeekday = day >= 1 && day <= 5;
    return { available: isWeekday, startTime: DEFAULT_START, endTime: DEFAULT_END };
  });
}

export function WeeklyAvailabilityEditor({ myAvailability }: { myAvailability: WeeklyAvailability[] }) {
  const [editing, setEditing] = useState(myAvailability.length === 0);
  const [drafts, setDrafts] = useState<DayDraft[]>(() => buildDrafts(myAvailability));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function startEditing() {
    setDrafts(buildDrafts(myAvailability));
    setError(null);
    setEditing(true);
  }

  function updateDraft(day: number, patch: Partial<DayDraft>) {
    setDrafts((prev) => prev.map((d, i) => (i === day ? { ...d, ...patch } : d)));
  }

  function handleSave() {
    setError(null);
    const days: WeeklyAvailabilityDayInput[] = [];
    for (let day = 0; day < 7; day++) {
      const draft = drafts[day];
      if (!draft.available) continue;
      if (draft.startTime >= draft.endTime) {
        setError(`${WEEKDAY_LABELS[day]}: end time must be after start time.`);
        return;
      }
      days.push({ dayOfWeek: day, startTime: draft.startTime, endTime: draft.endTime });
    }
    startTransition(async () => {
      try {
        await saveWeeklyAvailability(days);
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save your availability.");
      }
    });
  }

  if (!editing) {
    return (
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-muted-foreground">Your weekly availability</p>
          <Button type="button" variant="ghost" size="sm" onClick={startEditing}>
            Edit
          </Button>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-card/60 p-3 text-sm">
          {WEEKDAY_LABELS.map((label, day) => {
            const saved = myAvailability.find((a) => a.day_of_week === day);
            return (
              <div key={day} className="flex items-center justify-between">
                <span className={cn(!saved && "text-muted-foreground")}>{label}</span>
                <span className={cn("text-xs", saved ? "text-foreground" : "text-muted-foreground")}>
                  {saved ? `${formatTimeOfDay(saved.start_time)} – ${formatTimeOfDay(saved.end_time)}` : "Not available"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-1 text-sm font-semibold text-muted-foreground">Set your weekly availability</p>
      <p className="mb-2 text-xs text-muted-foreground">
        Which days do you work, and what hours? This is set once — you can edit it later, it won&apos;t change on
        its own.
      </p>
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card/60 p-3">
        {WEEKDAY_LABELS.map((label, day) => {
          const draft = drafts[day];
          return (
            <div key={day} className="flex flex-wrap items-center gap-2">
              <label className="flex w-28 shrink-0 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.available}
                  onChange={(e) => updateDraft(day, { available: e.target.checked })}
                  className="h-4 w-4 rounded border-border"
                />
                {label}
              </label>
              {draft.available ? (
                <>
                  <Input
                    type="time"
                    value={draft.startTime}
                    onChange={(e) => updateDraft(day, { startTime: e.target.value })}
                    className="h-8 w-28"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="time"
                    value={draft.endTime}
                    onChange={(e) => updateDraft(day, { endTime: e.target.value })}
                    className="h-8 w-28"
                  />
                </>
              ) : (
                <span className="text-xs text-muted-foreground">Not available</span>
              )}
            </div>
          );
        })}
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" disabled={isPending} onClick={handleSave}>
          Save
        </Button>
        {myAvailability.length > 0 && (
          <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
