"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { addWorkSession } from "@/lib/actions/work-session-actions";

/** Tomorrow, or Monday when tomorrow is a Sunday: the first day worth offering. */
function firstWorkDay(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA");
}

/**
 * Put a signed job on the calendar in one step.
 *
 * One button, then a start day, an optional last day and a note for the
 * crew. It books a work day the same way the Visits panel does -- the job's
 * dates follow it, the crew's calendars are checked, and the day shows on the
 * crew's board -- so there is nothing to keep in step afterwards.
 */
export function ScheduleJobButton({ jobId, size = "sm" }: { jobId: string; size?: "sm" | "default" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(firstWorkDay);
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button type="button" size={size} onClick={() => setOpen(true)}>
        <CalendarPlus className="mr-1 h-4 w-4" /> Schedule
      </Button>
    );
  }

  function book() {
    setMessage(null);
    startTransition(async () => {
      const result = await addWorkSession(jobId, start, end || start, note.trim() || null);
      if (!result.ok) {
        setMessage({ text: result.message, bad: true });
        return;
      }
      setMessage({ text: "Scheduled.", bad: false });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card/60 p-2">
      <label className="flex flex-col text-xs text-muted-foreground">
        Start
        <input
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
        />
      </label>
      <label className="flex flex-col text-xs text-muted-foreground">
        Last day (if more than one)
        <input
          type="date"
          value={end}
          min={start}
          onChange={(e) => setEnd(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
        />
      </label>
      <label className="flex min-w-48 flex-1 flex-col text-xs text-muted-foreground">
        Note for the crew
        <input
          type="text"
          value={note}
          placeholder="Optional"
          onChange={(e) => setNote(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
        />
      </label>
      <Button type="button" size="sm" disabled={pending || !start} onClick={book}>
        {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
        Book it
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {message && <p className={`w-full text-xs ${message.bad ? "text-red-700" : "text-emerald-700"}`}>{message.text}</p>}
    </div>
  );
}
