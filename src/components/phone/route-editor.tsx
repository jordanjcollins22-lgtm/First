"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { resetCrewRoutes, saveCrewRoutes } from "@/lib/actions/crew-route-actions";

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
 * Change today's routes: move a job up or down a crew's day, hand it to
 * another crew, or put it on a second crew too (both crews start there, say).
 * Nothing changes until Save; then every crew's Today follows the new order.
 */
export function RouteEditor({ day, crews: start, unassigned }: { day: string; crews: EditorCrew[]; unassigned: EditorStop[] }) {
  const router = useRouter();
  const [crews, setCrews] = useState<EditorCrew[]>(start);
  const [loose, setLoose] = useState<EditorStop[]>(unassigned);
  const [busy, run] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = useMemo(() => JSON.stringify(crews) !== JSON.stringify(start) || loose.length !== unassigned.length, [crews, start, loose, unassigned]);
  const onHowMany = (jobId: string) => crews.reduce((n, c) => n + c.stops.filter((s) => s.jobId === jobId).length, 0);

  const edit = (fn: (draft: EditorCrew[]) => void) => {
    setNote(null);
    setCrews((now) => {
      const draft = now.map((c) => ({ ...c, stops: [...c.stops] }));
      fn(draft);
      return draft;
    });
  };
  const moveUp = (ci: number, si: number) =>
    edit((d) => {
      if (si === 0) return;
      [d[ci].stops[si - 1], d[ci].stops[si]] = [d[ci].stops[si], d[ci].stops[si - 1]];
    });
  const moveDown = (ci: number, si: number) =>
    edit((d) => {
      if (si >= d[ci].stops.length - 1) return;
      [d[ci].stops[si + 1], d[ci].stops[si]] = [d[ci].stops[si], d[ci].stops[si + 1]];
    });
  const handTo = (ci: number, si: number, toLead: string) =>
    edit((d) => {
      const to = d.find((c) => c.leadId === toLead);
      if (!to || to === d[ci]) return;
      const [stop] = d[ci].stops.splice(si, 1);
      if (to.stops.some((s) => s.jobId === stop.jobId)) return; // already there
      to.stops.push(stop);
    });
  const alsoTo = (ci: number, si: number, toLead: string) =>
    edit((d) => {
      const to = d.find((c) => c.leadId === toLead);
      const stop = d[ci].stops[si];
      if (!to || to.stops.some((s) => s.jobId === stop.jobId)) return;
      to.stops.unshift({ sessionId: null, jobId: stop.jobId, customerName: stop.customerName });
    });
  const takeOff = (ci: number, si: number) =>
    edit((d) => {
      if (onHowMany(d[ci].stops[si].jobId) <= 1) return;
      d[ci].stops.splice(si, 1);
    });
  const place = (stop: EditorStop, toLead: string) => {
    setLoose((l) => l.filter((s) => s !== stop));
    edit((d) => d.find((c) => c.leadId === toLead)?.stops.push(stop));
  };

  const save = () =>
    run(async () => {
      if (loose.length) {
        setNote({ ok: false, text: "Put every job on a crew first." });
        return;
      }
      const res = await saveCrewRoutes({ day, crews: crews.map((c) => ({ leadId: c.leadId, stops: c.stops.map((s) => ({ sessionId: s.sessionId, jobId: s.jobId })) })) });
      setNote(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });
  const reset = () =>
    run(async () => {
      const res = await resetCrewRoutes({ day });
      setNote(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });

  return (
    <div className="vx-route-ed">
      {loose.length > 0 && (
        <div className="vx-route-crew">
          <h5>No crew yet</h5>
          {loose.map((s) => (
            <div key={s.jobId} className="vx-route-stop">
              <span className="vx-route-name">{s.customerName}</span>
              <select aria-label={`Give ${s.customerName} to a crew`} value="" onChange={(e) => e.target.value && place(s, e.target.value)}>
                <option value="">Give to…</option>
                {crews.map((c) => (
                  <option key={c.leadId} value={c.leadId}>
                    {c.name}&apos;s crew
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
      {crews.map((c, ci) => (
        <div key={c.leadId} className="vx-route-crew">
          <h5>
            <i style={{ background: c.color }} />
            {c.name}&apos;s crew
          </h5>
          {c.stops.length === 0 && <p className="vx-route-empty">Nothing today. Hand a job here to give this crew a day.</p>}
          {c.stops.map((s, si) => (
            <div key={`${s.jobId}-${s.sessionId ?? "new"}`} className="vx-route-stop">
              <span className="vx-route-n" style={{ background: c.color }}>
                {si + 1}
              </span>
              <span className="vx-route-name">
                {s.customerName}
                {onHowMany(s.jobId) > 1 && <small> · 2 crews</small>}
              </span>
              <span className="vx-route-btns">
                <button type="button" aria-label="Earlier" onClick={() => moveUp(ci, si)} disabled={si === 0}>
                  ↑
                </button>
                <button type="button" aria-label="Later" onClick={() => moveDown(ci, si)} disabled={si === c.stops.length - 1}>
                  ↓
                </button>
              </span>
              <span className="vx-route-more">
                <select aria-label={`Hand ${s.customerName} to another crew`} value="" onChange={(e) => e.target.value && handTo(ci, si, e.target.value)}>
                  <option value="">Move to…</option>
                  {crews
                    .filter((o) => o.leadId !== c.leadId)
                    .map((o) => (
                      <option key={o.leadId} value={o.leadId}>
                        {o.name}&apos;s crew
                      </option>
                    ))}
                </select>
                <select aria-label={`Also put ${s.customerName} on another crew`} value="" onChange={(e) => e.target.value && alsoTo(ci, si, e.target.value)}>
                  <option value="">Both crews…</option>
                  {crews
                    .filter((o) => o.leadId !== c.leadId && !o.stops.some((x) => x.jobId === s.jobId))
                    .map((o) => (
                      <option key={o.leadId} value={o.leadId}>
                        + {o.name}&apos;s crew too
                      </option>
                    ))}
                </select>
                {onHowMany(s.jobId) > 1 && (
                  <button type="button" className="vx-route-x" onClick={() => takeOff(ci, si)}>
                    Take off this crew
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      ))}
      <div className="vx-route-actions">
        <button type="button" className="vx-cta" onClick={save} disabled={busy || !changed}>
          {busy ? "Saving…" : changed ? "Save routes" : "No changes"}
        </button>
        <button type="button" className="vx-route-reset" onClick={reset} disabled={busy}>
          Back to nearest-next
        </button>
      </div>
      {note && <p className={note.ok ? "vx-route-ok" : "vx-route-err"}>{note.text}</p>}
    </div>
  );
}
