"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { finishFollowUp } from "@/lib/actions/follow-up-actions";

/** Done on a follow-up, with what happened. Save stays off until there is something written. */
export function FollowUpDone({ id, onSkip }: { id: string; onSkip: () => void }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const save = () =>
    start(async () => {
      const r = await finishFollowUp(id, what);
      setNote(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) {
        setOpen(false);
        setWhat("");
        router.refresh();
      }
    });

  return (
    <>
      {open && (
        <textarea className="vx-why" rows={2} value={what} onChange={(e) => setWhat(e.target.value)} placeholder="What happened?" aria-label="What happened" />
      )}
      <div className="vx-2b">
        {open ? (
          <button type="button" className="vx-cta" disabled={busy || what.trim().length < 3} onClick={save}>
            Save
          </button>
        ) : (
          <button type="button" className="vx-cta" onClick={() => setOpen(true)}>
            Done
          </button>
        )}
        <button type="button" className="vx-cta vx-alt" disabled={busy} onClick={onSkip}>
          Skip
        </button>
      </div>
      {note && <div className={note.ok ? "vx-note ok" : "vx-note bad"}>{note.text}</div>}
    </>
  );
}
