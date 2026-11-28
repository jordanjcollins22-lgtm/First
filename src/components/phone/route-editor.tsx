"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  resetCrewRoutes,
  saveCrewRoutes,
} from "@/lib/actions/crew-route-actions";

export interface EditorStop {
  sessionId: string | null;
  jobId: string;
  customerName: string;
}

export interface EditorCrew {
  leadId: string;
  name: string;
  color: string;
  stops: EditorStop[];
}

/**
 * Change today's routes the way the office thinks about it: go job by job and
 * tap which crews go there (one crew, or both to start together), then set
 * each crew's order. Nothing changes until Save; then every crew's Today
 * follows it.
 */
export function RouteEditor({
  day,
  crews: start,
  unassigned,
}: {
  day: string;
  crews: EditorCrew[];
  unassigned: EditorStop[];
}) {
  const router = useRouter();
  const [crews, setCrews] = useState<EditorCrew[]>(start);
  const [busy, run] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  // Every job on today, in the order they first show up.
  const jobs = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of [...start.flatMap((c) => c.stops), ...unassigned])
      if (!seen.has(s.jobId)) seen.set(s.jobId, s.customerName);
    return [...seen.entries()].map(([jobId, customerName]) => ({
      jobId,
      customerName,
    }));
  }, [start, unassigned]);
  const crewsOn = (jobId: string) =>
    crews.filter((c) => c.stops.some((s) => s.jobId === jobId));
  const noCrew = jobs.filter((j) => crewsOn(j.jobId).length === 0);
  const changed = JSON.stringify(crews) !== JSON.stringify(start);

  const edit = (fn: (draft: EditorCrew[]) => void) => {
    setNote(null);
    setCrews((now) => {
      const draft = now.map((c) => ({ ...c, stops: [...c.stops] }));
      fn(draft);
      return draft;
    });
  };

  /** Tap a crew on a job: send it there, or take it off (a job always keeps one crew). */
  const toggle = (jobId: string, customerName: string, leadId: string) =>
    edit((d) => {
      const crew = d.find((c) => c.leadId === leadId)!;
      const at = crew.stops.findIndex((s) => s.jobId === jobId);
      if (at >= 0) {
        if (d.filter((c) => c.stops.some((s) => s.jobId === jobId)).length <= 1)
          return;
        crew.stops.splice(at, 1);
        return;
      }
      const loose = unassigned.find((s) => s.jobId === jobId);
      const taken = new Set(d.flatMap((c) => c.stops.map((s) => s.sessionId)));
      crew.stops.push({
        sessionId:
          loose && !taken.has(loose.sessionId) ? loose.sessionId : null,
        jobId,
        customerName,
      });
    });
  const move = (ci: number, si: number, by: -1 | 1) =>
    edit((d) => {
      const to = si + by;
      if (to < 0 || to >= d[ci].stops.length) return;
      [d[ci].stops[to], d[ci].stops[si]] = [d[ci].stops[si], d[ci].stops[to]];
    });

  const save = () =>
    run(async () => {
      if (noCrew.length) {
        setNote({
          ok: false,
          text: `Send a crew to ${noCrew.map((j) => j.customerName).join(", ")} first.`,
        });
        return;
      }
      const res = await saveCrewRoutes({
        day,
        crews: crews.map((c) => ({
          leadId: c.leadId,
          stops: c.stops.map((s) => ({
            sessionId: s.sessionId,
            jobId: s.jobId,
          })),
        })),
      });
      setNote(
        res.ok
          ? { ok: true, text: res.message }
          : { ok: false, text: res.error },
      );
      if (res.ok) router.refresh();
    });
  const reset = () =>
    run(async () => {
      const res = await resetCrewRoutes({ day });
      setNote(
        res.ok
          ? { ok: true, text: res.message }
          : { ok: false, text: res.error },
      );
      if (res.ok) router.refresh();
    });

  return (
    <div className="vx-route-ed">
      <div className="vx-route-crew">
        <h5>Who goes to each job</h5>
        {jobs.map((j) => (
          <div key={j.jobId} className="vx-route-job">
            <span className="vx-route-name">{j.customerName}</span>
            <span
              className="vx-route-pick"
              role="group"
              aria-label={`Crews going to ${j.customerName}`}
            >
              {crews.map((c) => {
                const on = c.stops.some((s) => s.jobId === j.jobId);
                return (
                  <button
                    key={c.leadId}
                    type="button"
                    aria-pressed={on}
                    className={on ? "on" : ""}
                    style={
                      on
                        ? { background: c.color, borderColor: c.color }
                        : { borderColor: c.color }
                    }
                    onClick={() => toggle(j.jobId, j.customerName, c.leadId)}
                  >
                    {on ? "✓ " : "+ "}
                    {c.name}
                  </button>
                );
              })}
            </span>
          </div>
        ))}
      </div>

      {crews.map((c, ci) =>
        c.stops.length === 0 ? null : (
          <div key={c.leadId} className="vx-route-crew">
            <h5>
              <i style={{ background: c.color }} />
              {c.name}&apos;s order
            </h5>
            {c.stops.map((s, si) => (
              <div
                key={`${s.jobId}-${s.sessionId ?? "new"}`}
                className="vx-route-stop"
              >
                <span className="vx-route-n" style={{ background: c.color }}>
                  {si + 1}
                </span>
                <span className="vx-route-name">
                  {s.customerName}
                  {crewsOn(s.jobId).length > 1 && (
                    <small>
                      {" "}
                      · with{" "}
                      {crewsOn(s.jobId)
                        .filter((o) => o !== c)
                        .map((o) => o.name)
                        .join(", ")}
                    </small>
                  )}
                </span>
                <span className="vx-route-btns">
                  <button
                    type="button"
                    aria-label="Earlier"
                    onClick={() => move(ci, si, -1)}
                    disabled={si === 0}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="Later"
                    onClick={() => move(ci, si, 1)}
                    disabled={si === c.stops.length - 1}
                  >
                    ↓
                  </button>
                </span>
              </div>
            ))}
          </div>
        ),
      )}

      <div className="vx-route-actions">
        <button
          type="button"
          className="vx-cta"
          onClick={save}
          disabled={busy || !changed}
        >
          {busy ? "Saving…" : changed ? "Save routes" : "No changes"}
        </button>
        <button
          type="button"
          className="vx-route-reset"
          onClick={reset}
          disabled={busy}
        >
          Back to nearest-next
        </button>
      </div>
      {note && (
        <p className={note.ok ? "vx-route-ok" : "vx-route-err"}>{note.text}</p>
      )}
    </div>
  );
}
