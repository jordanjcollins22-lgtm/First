"use client";

import { useState, useTransition } from "react";

import { setEmailApprovalRequired } from "@/lib/actions/outbound-approval-actions";

/** Read everything before it goes, or let it go on its own. */
export function ApprovalSwitch({ required }: { required: boolean }) {
  const [on, setOn] = useState(required);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <section className="rounded-2xl border border-border bg-card/70 p-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          onChange={(event) => {
            const next = event.target.checked;
            setOn(next);
            start(async () => {
              const result = await setEmailApprovalRequired(next);
              setNote(result.message);
              if (!result.ok) setOn(!next);
            });
          }}
          className="mt-1 h-4 w-4"
        />
        <span>
          <span className="block font-semibold">Ask me before any automatic email goes</span>
          <span className="block text-sm text-muted-foreground">
            Every email the app writes on its own, the evaluation sequence and the reminders, waits on My Day
            until you approve it. You get one note in your inbox when something is waiting.
          </span>
        </span>
      </label>
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
    </section>
  );
}
