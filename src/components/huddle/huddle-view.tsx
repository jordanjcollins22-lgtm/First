"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveHuddleNotes } from "@/lib/actions/huddle-actions";
import { HUDDLE_STEPS, huddleText, type Huddle } from "@/lib/huddle";

/**
 * The team huddle, step by step in the order it is run. The owner or the
 * account manager can type the number, the watch-outs, the blockers and the
 * shout-out right on it; everyone else reads it.
 */
export function HuddleView({ huddle, canEdit }: { huddle: Huddle; canEdit: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [goal, setGoal] = useState(huddle.goal);
  const [watchOuts, setWatchOuts] = useState(huddle.watchOuts);
  const [blockers, setBlockers] = useState(huddle.blockers);
  const [shoutOut, setShoutOut] = useState(huddle.shoutOut);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = goal !== huddle.goal || watchOuts !== huddle.watchOuts || blockers !== huddle.blockers || shoutOut !== huddle.shoutOut;

  const save = () =>
    start(async () => {
      const r = await saveHuddleNotes(huddle.day, { goal, watchOuts, blockers, shoutOut });
      setNote(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    });

  const copy = async () => {
    const text = huddleText({ ...huddle, goal, watchOuts, blockers, shoutOut }, window.location.origin);
    try {
      await navigator.clipboard.writeText(text);
      setNote({ ok: true, text: "Copied. Paste it into the team text." });
    } catch {
      setNote({ ok: false, text: "Couldn't copy on this phone." });
    }
  };

  const field = (value: string, set: (v: string) => void, placeholder: string, label: string) =>
    canEdit ? (
      <textarea className="vx-why" rows={2} value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} aria-label={label} />
    ) : value ? (
      <div className="vx-q" style={{ whiteSpace: "pre-line", marginTop: 8 }}>{value}</div>
    ) : null;

  const [number, crews, watch, block, shout] = HUDDLE_STEPS;

  return (
    <>
      <Step n={1} title={number.title} minutes={number.minutes} prompt={number.prompt}>
        {canEdit ? field(goal, setGoal, "Today's number", "Today's number") : <div className="vx-big" style={{ fontSize: 16 }}>{goal}</div>}
      </Step>

      <Step n={2} title={crews.title} minutes={crews.minutes} prompt={crews.prompt}>
        {huddle.crews.length === 0 && <div className="vx-sm" style={{ marginTop: 8 }}>No crews on the schedule for this day.</div>}
        {huddle.crews.map((c) => (
          <details key={c.name} className="vx-crew" open>
            <summary>
              <span>{c.name}</span>
              <b>{c.stops.length ? `${c.stops.length} ${c.stops.length === 1 ? "stop" : "stops"}` : ""}</b>
            </summary>
            {c.meet && <div className="vx-sm" style={{ margin: "4px 0" }}>{c.meet}</div>}
            {c.stops.map((s, i) => {
              const line = (
                <>
                  <span>
                    {i + 1}. {s.client}
                    {s.work ? <span style={{ display: "block", fontWeight: 400, opacity: 0.8 }}>{s.work}</span> : null}
                  </span>
                  <b>{s.time || (s.jobId ? "Crew page" : "")}</b>
                </>
              );
              return s.jobId ? (
                <a key={`${s.jobId}-${i}`} href={`/crew/${s.jobId}`} className="vx-row vx-tap">
                  {line}
                </a>
              ) : (
                <div key={`${s.client}-${i}`} className="vx-row">
                  {line}
                </div>
              );
            })}
            <div className="vx-sm" style={{ marginTop: 4 }}>Ask the lead: what do you need that you don&apos;t have yet?</div>
          </details>
        ))}
      </Step>

      <Step n={3} title={watch.title} minutes={watch.minutes} prompt={watch.prompt}>
        {field(watchOuts, setWatchOuts, "Anything that could go wrong today", "Watch-outs")}
      </Step>

      <Step n={4} title={block.title} minutes={block.minutes} prompt={block.prompt}>
        {field(blockers, setBlockers, "Write each one down", "Blockers")}
      </Step>

      <Step n={5} title={shout.title} minutes={shout.minutes} prompt={shout.prompt}>
        {field(shoutOut, setShoutOut, "Who, and what they did", "Shout-out")}
      </Step>

      <div className="vx-card">
        <div className="vx-big" style={{ fontSize: 18 }}>Then roll.</div>
        <div className="vx-2b" style={{ marginTop: 8 }}>
          {canEdit && (
            <button type="button" className="vx-cta" disabled={busy || !changed} onClick={save}>
              Save
            </button>
          )}
          <button type="button" className="vx-cta vx-alt" onClick={copy}>
            Copy for the team text
          </button>
        </div>
        {note && <div className={note.ok ? "vx-note ok" : "vx-note bad"}>{note.text}</div>}
      </div>
    </>
  );
}

function Step({ n, title, minutes, prompt, children }: { n: number; title: string; minutes: number; prompt: string; children?: React.ReactNode }) {
  return (
    <div className="vx-card">
      <div className="vx-one-h">
        <span className="vx-ct">
          {n}. {title}
        </span>
        <span className="vx-one-n">{minutes} min</span>
      </div>
      <div className="vx-sm">{prompt}</div>
      {children}
    </div>
  );
}
