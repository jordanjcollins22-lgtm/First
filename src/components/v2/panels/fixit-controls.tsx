"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { approveFixitBuildAction, registerDiscordCommandsAction, sendBackFixitTicketAction, type FixitResult } from "@/lib/actions/fixit-actions";

/**
 * The Fix-it tickets panel's buttons. Each calls its server action (the same
 * as the Discord command), says what happened under it, and refreshes.
 */

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<FixitResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setNote(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) after?.();
      router.refresh();
    });
  return { pending, note, run };
}

function Note({ note }: { note: { ok: boolean; text: string } | null }) {
  if (!note) return null;
  return (
    <p role="status" className={`text-xs ${note.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
      {note.text}
    </p>
  );
}

export function RegisterCommandsButton() {
  const { pending, note, run } = useRun();
  return (
    <div className="space-y-1">
      <Button type="button" variant="secondary" className="min-h-11" disabled={pending} onClick={() => run(registerDiscordCommandsAction)}>
        Register Discord commands
      </Button>
      <Note note={note} />
    </div>
  );
}

export function ApproveBuildButton({ number }: { number: number }) {
  const { pending, note, run } = useRun();
  return (
    <div className="space-y-1">
      <Button
        type="button"
        className="min-h-11"
        disabled={pending}
        onClick={() => {
          if (window.confirm(`Approve build #${number} and put it live?`)) run(approveFixitBuildAction);
        }}
      >
        Approve
      </Button>
      <Note note={note} />
    </div>
  );
}

export function SendBackForm({ number }: { number: number }) {
  const { pending, note, run } = useRun();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open)
    return (
      <Button type="button" variant="ghost" className="min-h-11" onClick={() => setOpen(true)}>
        Send back
      </Button>
    );
  return (
    <form
      className="flex w-full flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => sendBackFixitTicketAction(number, text), () => {
          setText("");
          setOpen(false);
        });
      }}
    >
      <Input className="min-h-11 min-w-0 flex-1" value={text} placeholder="What's still wrong?" aria-label={`Note for ticket #${number}`} onChange={(e) => setText(e.target.value)} />
      <Button type="submit" className="min-h-11" disabled={pending || !text.trim()}>
        Send back
      </Button>
      <Button type="button" variant="ghost" className="min-h-11" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      <Note note={note} />
    </form>
  );
}
