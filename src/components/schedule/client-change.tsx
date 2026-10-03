"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  cancelEvaluationForClient,
  cancelVisitForClient,
  moveEvaluationForClient,
  moveVisitForClient,
  type ClientChangeResult,
} from "@/lib/actions/client-change-actions";

type Target = { kind: "evaluation"; jobId: string } | { kind: "visit"; visitId: string };

/**
 * On a card on the account manager's progress bar: the client rang to move
 * it or call it off. One button, then either a new day (and time, for an
 * evaluation) or what they said. A work visit is only the visit: the job
 * stays sold and goes back to needing a date.
 */
export function ClientChange({ target, demo = false }: { target: Target; demo?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"move" | "cancel">("move");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const isEvaluation = target.kind === "evaluation";

  function run(task: () => Promise<ClientChangeResult>) {
    setError(null);
    if (demo) return;
    start(async () => {
      const result = await task();
      if (!result.ok) return setError(result.message);
      setDone(result.message);
      setOpen(false);
      router.refresh();
    });
  }

  function confirm() {
    if (mode === "move") {
      run(() => (target.kind === "evaluation" ? moveEvaluationForClient(target.jobId, date, time) : moveVisitForClient(target.visitId, date)));
    } else {
      run(() => (target.kind === "evaluation" ? cancelEvaluationForClient(target.jobId, reason) : cancelVisitForClient(target.visitId, reason)));
    }
  }

  if (!open) {
    return (
      <div className="mt-2 flex flex-col gap-1">
        {done && <p className="text-xs font-medium text-emerald-700">{done}</p>}
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setDone(null);
          }}
          className="flex h-9 items-center justify-center gap-1.5 self-start rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-accent/40"
        >
          <CalendarClock className="h-3.5 w-3.5" /> Client wants to reschedule or cancel
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-muted/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">The client asked to…</p>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-background p-1">
        {(["move", "cancel"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={cn("h-9 rounded-md text-sm font-semibold", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
          >
            {m === "move" ? "Reschedule" : "Cancel"}
          </button>
        ))}
      </div>

      {mode === "move" ? (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">
            New day
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-0.5 h-10 w-full rounded-md border border-border bg-background px-2 text-sm" />
          </label>
          {isEvaluation && (
            <label className="text-xs font-medium">
              New time
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-0.5 h-10 w-full rounded-md border border-border bg-background px-2 text-sm" />
            </label>
          )}
          <p className="text-xs text-muted-foreground">
            {isEvaluation
              ? "Same length as it was booked for. Tell the client the new time while you have them on the phone."
              : "Same number of days as it was booked for, with the same crew."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">
            What did they say?
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Rain all week, wants to wait"
              className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            {isEvaluation
              ? "The evaluation comes off the calendar, with their reason on the record."
              : "Only today's visit comes off. The job stays sold and needs a new date."}
          </p>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button
        type="button"
        onClick={confirm}
        disabled={pending || (mode === "move" ? !date : reason.trim().length < 3)}
        variant={mode === "cancel" ? "destructive" : "default"}
        className="h-10 font-semibold"
      >
        {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        {mode === "move" ? (isEvaluation ? "Move the evaluation" : "Move the visit") : isEvaluation ? "Cancel the evaluation" : "Cancel today's visit"}
      </Button>
    </div>
  );
}
