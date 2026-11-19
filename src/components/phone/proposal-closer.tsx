"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { closeOpenProposal } from "@/lib/actions/proposal-close-actions";
import { closeBlocker, type CloseOutcome } from "@/lib/proposal-outcome";

/**
 * Yes or No on an open proposal, and why. Save stays off until both are
 * there, so nothing closes without a reason.
 */
export function ProposalCloser({
  proposalId,
  onSkip,
}: {
  proposalId: string;
  onSkip: () => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [outcome, setOutcome] = useState<CloseOutcome | null>(null);
  const [why, setWhy] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const ready = outcome != null && closeBlocker(outcome, why) == null;

  const save = () =>
    start(async () => {
      if (!outcome) return;
      const r = await closeOpenProposal(proposalId, outcome, why);
      setNote(
        r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error },
      );
      if (r.ok) {
        setOutcome(null);
        setWhy("");
        router.refresh();
      }
    });

  return (
    <>
      <div className="vx-q">Did they say yes?</div>
      <div className="vx-2b">
        <button
          type="button"
          className={outcome === "won" ? "vx-cta" : "vx-cta vx-alt"}
          aria-pressed={outcome === "won"}
          disabled={busy}
          onClick={() => setOutcome("won")}
        >
          Yes, won
        </button>
        <button
          type="button"
          className={outcome === "lost" ? "vx-cta" : "vx-cta vx-alt"}
          aria-pressed={outcome === "lost"}
          disabled={busy}
          onClick={() => setOutcome("lost")}
        >
          No, lost
        </button>
      </div>
      {outcome && (
        <>
          <textarea
            className="vx-why"
            rows={2}
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder={
              outcome === "won"
                ? "Why did they say yes?"
                : "Why did we lose it?"
            }
            aria-label="Why"
          />
          <div className="vx-2b">
            <button
              type="button"
              className="vx-cta"
              disabled={busy || !ready}
              onClick={save}
            >
              Save and close
            </button>
            <button
              type="button"
              className="vx-cta vx-alt"
              disabled={busy}
              onClick={onSkip}
            >
              Skip
            </button>
          </div>
        </>
      )}
      {!outcome && (
        <div className="vx-2b">
          <button type="button" className="vx-cta vx-alt" onClick={onSkip}>
            Skip
          </button>
        </div>
      )}
      {note && (
        <div className={note.ok ? "vx-note ok" : "vx-note bad"}>
          {note.text}
        </div>
      )}
    </>
  );
}
