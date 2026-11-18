"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { approveProposal, sendProposalToClient } from "@/lib/actions/proposal-actions";

/** A proposal waiting on a yes: approve it, then email it to the client. */
export function ProposalButtons({ jobId, status }: { jobId: string; status: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const run = (task: () => Promise<string>) =>
    start(async () => {
      try {
        setNote(await task());
        router.refresh();
      } catch (err) {
        setNote(err instanceof Error ? err.message : "That didn't go through. Try again.");
      }
    });

  return (
    <>
      <div className="vx-2b">
        {status === "needs_approval" && (
          <button type="button" className="vx-cta" disabled={busy} onClick={() => run(async () => (await approveProposal(jobId), "Approved. Now send it."))}>
            Approve
          </button>
        )}
        {status === "sent" && (
          <button
            type="button"
            className="vx-cta"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await sendProposalToClient(jobId);
                return r.ok ? `Sent to ${r.to}.` : r.error;
              })
            }
          >
            Email it to the client
          </button>
        )}
      </div>
      {note && <div className="vx-note">{note}</div>}
    </>
  );
}
