"use client";

import { useState, useTransition } from "react";

import { previewDigest, sendDigestNow, setDigestEnabled } from "@/lib/actions/approval-queue-actions";

/** The Monday digest's switch, and a look at what it would say today. */
export function DigestControls({ enabled, lastSentAt }: { enabled: boolean; lastSentAt: string | null }) {
  const [on, setOn] = useState(enabled);
  const [note, setNote] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await setDigestEnabled(!on);
              setNote(result.message);
              if (result.ok) setOn(!on);
            })
          }
          className={"min-h-11 rounded-lg px-3 text-sm font-semibold " + (on ? "bg-primary text-primary-foreground" : "border")}
        >
          {on ? "On: every Monday at 7am" : "Off"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await previewDigest();
              if (result.ok) setPreview(`${result.subject}\n\n${result.text}`);
              else setNote(result.message);
            })
          }
          className="min-h-11 rounded-lg border px-3 text-sm font-semibold"
        >
          Preview this week&apos;s
        </button>
        <button
          type="button"
          disabled={pending || !on}
          onClick={() =>
            start(async () => {
              const result = await sendDigestNow();
              setNote(result.message);
            })
          }
          className="min-h-11 rounded-lg border px-3 text-sm font-semibold disabled:opacity-50"
        >
          Send it now
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {lastSentAt ? `Last sent ${new Date(lastSentAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.` : "Not sent yet."} Goes to whoever holds the owner role, by text or email. Once a week, however many times it is pressed.
      </p>
      {note && <p className="text-sm" role="status">{note}</p>}
      {preview && <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 font-sans text-sm">{preview}</pre>}
    </div>
  );
}
