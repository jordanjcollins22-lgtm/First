"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { bookVisit, cancelVisit, finishVisit, markVisit, undoVisit, type VisitResult } from "@/lib/actions/evaluation-visit-actions";
import type { VisitStage } from "@/lib/evaluation-visit";

function useAct() {
  const router = useRouter();
  const [busy, run] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const act = (f: () => Promise<VisitResult>, after?: () => void) =>
    run(async () => {
      setNote(null);
      const r = await f();
      if (r.ok) {
        after?.();
        router.refresh();
      } else setNote(r.message);
    });
  return { busy, note, act };
}

/**
 * The visit, one tap at a time: On my way, I'm here, Done. Each step can be
 * taken back for a mis-tap until the visit is done.
 */
export function VisitSteps({ jobId, stage }: { jobId: string; stage: VisitStage }) {
  const { busy, note, act } = useAct();
  return (
    <>
      <div className="vx-2b">
        {stage === "booked" && (
          <button type="button" className="vx-cta" disabled={busy} onClick={() => act(() => markVisit(jobId, "on_way"))}>
            On my way
          </button>
        )}
        {stage === "on_way" && (
          <button type="button" className="vx-cta" disabled={busy} onClick={() => act(() => markVisit(jobId, "arrived"))}>
            I&apos;m here
          </button>
        )}
        {stage === "arrived" && (
          <button type="button" className="vx-cta" disabled={busy} onClick={() => act(() => finishVisit(jobId))}>
            Visit done
          </button>
        )}
        {(stage === "on_way" || stage === "arrived") && (
          <button type="button" className="vx-cta vx-alt" disabled={busy} onClick={() => act(() => undoVisit(jobId))}>
            Undo
          </button>
        )}
      </div>
      {note && <div className="vx-note bad">{note}</div>}
    </>
  );
}

/** Marks a past visit done without the steps, for one that happened but wasn't tapped through. */
export function FinishVisit({ jobId }: { jobId: string }) {
  const { busy, note, act } = useAct();
  return (
    <>
      <button type="button" className="vx-cta vx-alt" disabled={busy} onClick={() => act(() => finishVisit(jobId))}>
        Mark visit done
      </button>
      {note && <div className="vx-note bad">{note}</div>}
    </>
  );
}

/** Book a visit, or move or call off a booked one: a day and a time, an hour long. */
export function BookVisit({ jobId, day: startDay, time: startTime = "10:00", label = "Book visit", canCancel = false }: { jobId: string; day: string; time?: string; label?: string; canCancel?: boolean }) {
  const { busy, note, act } = useAct();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(startDay);
  const [time, setTime] = useState(startTime);
  if (!open)
    return (
      <>
        <button type="button" className="vx-cta vx-alt vx-sched-open" onClick={() => setOpen(true)}>
          {label}
        </button>
        {note && <div className="vx-note bad">{note}</div>}
      </>
    );
  return (
    <div className="vx-sched">
      <label>
        Day
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      </label>
      <label>
        Time
        <input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
      </label>
      <div className="vx-2b">
        <button type="button" className="vx-cta" disabled={busy || !day || !time} onClick={() => act(() => bookVisit(jobId, day, time), () => setOpen(false))}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="vx-cta vx-alt" disabled={busy} onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      {canCancel && (
        <button type="button" className="vx-cta vx-alt" disabled={busy} onClick={() => act(() => cancelVisit(jobId), () => setOpen(false))}>
          Call off this visit
        </button>
      )}
      {note && <div className="vx-note bad">{note}</div>}
    </div>
  );
}
