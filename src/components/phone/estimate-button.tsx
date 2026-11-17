"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { startEstimate } from "@/lib/actions/estimate-start-actions";

/** Opens the free-estimate map for this job, making its link first when there is none. */
export function EstimateButton({ jobId, label }: { jobId: string; label: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="vx-cta"
        disabled={busy}
        onClick={() =>
          start(async () => {
            setNote(null);
            const r = await startEstimate(jobId);
            if (r.ok) router.push(`/prep/${r.token}/map`);
            else setNote(r.error);
          })
        }
      >
        {label}
      </button>
      {note && <div className="vx-note bad">{note}</div>}
    </>
  );
}
