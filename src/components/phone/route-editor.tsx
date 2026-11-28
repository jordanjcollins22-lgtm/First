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
  /** Shown under the name, as on everyone's list. */
  address?: string;
  leftToDo?: string | null;
  crewMap?: string;
}

export interface EditorCrew {
  leadId: string;
  name: string;
  color: string;
  stops: EditorStop[];
}

/**
 * Today's list, crew by crew in the order they go, for the account manager
 * and up: the same list everyone sees, plus arrows to change the order and a
 * crew button on each job to send a crew there (tap two to start together).
 * Nothing changes until Save; then every crew's Today follows it.
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

  const info = new Map(
    [...start.flatMap((c) => c.stops), ...unassigned].map((s) => [s.jobId, s]),
  );
  const picks = (jobId: string, customerName: string) => (
    <span
      className="vx-route-pick"
      role="group"
      aria-label={`Crews going to ${customerName}`}
    >
      {crews.map((o) => {
        const on = o.stops.some((x) => x.jobId === jobId);
        return (
          <button
            key={o.leadId}
            type="button"
            aria-pressed={on}
            className={on ? "on" : ""}
            style={
              on
                ? { background: o.color, borderColor: o.color }
                : { borderColor: o.color }
            }
            onClick={() => toggle(jobId, customerName, o.leadId)}
          >
            {on ? "✓ " : "+ "}
            {o.name}
          </button>
        );
      })}
    </span>
  );
  const about = (jobId: string) => {
    const s = info.get(jobId);
    return (
      <>
        {s?.address && (
          <small className="vx-route-sub">
            {s.address.replace(/, (Maryland|MD) \d{5}.*$/, "")}
          </small>
        )}
        {s?.leftToDo && (
          <small className="vx-route-sub">Left to do: {s.leftToDo}</small>
        )}
        {s?.crewMap && (
          <a className="vx-route-link" href={s.crewMap}>
            Crew map
          </a>
        )}
      </>
    );
  };

  return (
    <div className="vx-route-ed">
      {noCrew.length > 0 && (
        <div className="vx-route-crew">
          <h5>No crew yet</h5>
          {noCrew.map((j) => (
            <div key={j.jobId} className="vx-route-stop">
              <span className="vx-route-name">
                {j.customerName}
                {about(j.jobId)}
              </span>
              <span className="vx-route-more">
                {picks(j.jobId, j.customerName)}
              </span>
            </div>
          ))}
        </div>
      )}
      {crews.map((c, ci) =>
        c.stops.length === 0 ? null : (
          <div key={c.leadId} className="vx-route-crew">
            <h5>
              <i style={{ background: c.color }} />
              {c.name}&apos;s crew
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
                  {si === 0 && (
                    <small className="vx-route-sub"> · Start here</small>
                  )}
                  {about(s.jobId)}
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
                <span className="vx-route-more">
                  {picks(s.jobId, s.customerName)}
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
