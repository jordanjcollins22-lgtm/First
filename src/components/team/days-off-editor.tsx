"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDayOff, removeDayOff } from "@/lib/actions/availability-actions";

export interface MyDayOff {
  date: string;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
}

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

function timeLabel(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * The days somebody can't work, one at a time.
 *
 * A whole day, or part of one when they only need the morning. Nobody can be
 * booked onto a job or an evaluation over it: the booking is refused and
 * says why.
 */
export function DaysOffEditor({ daysOff, today }: { daysOff: MyDayOff[]; today: string }) {
  const [date, setDate] = useState("");
  const [partDay, setPartDay] = useState(false);
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("12:00");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function add() {
    setError(null);
    if (!date) {
      setError("Pick the day.");
      return;
    }
    setBusy("add");
    startTransition(async () => {
      try {
        await addDayOff(date, reason || null, partDay ? start : null, partDay ? end : null);
        setDate("");
        setReason("");
        setPartDay(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save that day.");
      } finally {
        setBusy(null);
      }
    });
  }

  function remove(day: string) {
    setBusy(day);
    startTransition(async () => {
      try {
        await removeDayOff(day);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't remove that day.");
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-muted-foreground">Days you can&apos;t work</p>
      {daysOff.length === 0 ? (
        <p className="mb-3 text-xs text-muted-foreground">None coming up.</p>
      ) : (
        <ul className="mb-3 divide-y divide-border/60 rounded-lg border border-border bg-card/60">
          {daysOff.map((d) => (
            <li key={d.date} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{dayLabel(d.date)}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {d.startTime && d.endTime ? `${timeLabel(d.startTime)} – ${timeLabel(d.endTime)}` : "All day"}
                  {d.reason ? ` · ${d.reason}` : ""}
                </span>
              </span>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove this day off" disabled={busy !== null} onClick={() => remove(d.date)}>
                {busy === d.date ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card/60 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className="h-9 w-40" aria-label="Day off" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={partDay} onChange={(e) => setPartDay(e.target.checked)} className="h-4 w-4 rounded border-border" />
            Only part of the day
          </label>
        </div>
        {partDay && (
          <div className="flex items-center gap-2">
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="h-8 w-28" aria-label="From" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="h-8 w-28" aria-label="Until" />
          </div>
        )}
        <Input type="text" value={reason} placeholder="Reason (optional)" onChange={(e) => setReason(e.target.value)} className="h-9" />
        <div>
          <Button type="button" size="sm" disabled={busy !== null} onClick={add}>
            {busy === "add" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Add day off
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
