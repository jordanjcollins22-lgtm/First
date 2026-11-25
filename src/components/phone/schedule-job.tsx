"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { scheduleJob } from "@/lib/actions/schedule-actions";

export type CrewOption = { id: string; name: string };

/**
 * Schedule (or move) a job in three taps: day, how many days, whose crew.
 * Opens under the job's line on the crew schedule.
 */
export function ScheduleJob({
  jobId,
  crews,
  start,
  days: startDays = 1,
  leadId,
  label = "Schedule",
}: {
  jobId: string;
  crews: CrewOption[];
  start: string;
  days?: number;
  leadId?: string | null;
  label?: string;
}) {
  const router = useRouter();
  const [busy, run] = useTransition();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(start);
  const [days, setDays] = useState(startDays);
  const [lead, setLead] = useState(leadId ?? crews[0]?.id ?? "");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const save = () =>
    run(async () => {
      const r = await scheduleJob({ jobId, startsOn: day, days, leadId: lead });
      setNote(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) {
        setOpen(false);
        router.refresh();
      }
    });

  if (!open) {
    return (
      <>
        <button type="button" className="vx-cta vx-alt vx-sched-open" onClick={() => setOpen(true)}>
          {label}
        </button>
        {note && <div className={note.ok ? "vx-note ok" : "vx-note bad"}>{note.text}</div>}
      </>
    );
  }
  return (
    <div className="vx-sched">
      <label>
        Start
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      </label>
      <label>
        Days
        <input type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} />
      </label>
      <label className="vx-sched-crew">
        Crew
        <select value={lead} onChange={(e) => setLead(e.target.value)}>
          {crews.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}&apos;s crew
            </option>
          ))}
        </select>
      </label>
      <div className="vx-2b">
        <button type="button" className="vx-cta" disabled={busy || !day || !lead} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="vx-cta vx-alt" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {note && !note.ok && <div className="vx-note bad">{note.text}</div>}
    </div>
  );
}
