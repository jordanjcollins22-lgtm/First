"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Megaphone } from "lucide-react";

import {
  EXCEPTION_KINDS,
  KIND_LABEL,
  KIND_MEANS,
  OPENS_A_CHANGE_REQUEST,
  STOPS_WORK_BY_DEFAULT,
  type ExceptionKind,
} from "@/lib/exceptions";
import { reportException } from "@/lib/actions/exception-actions";

/**
 * The one button in the field.
 *
 * Everything a crew currently phones the owner about goes through here, so it
 * has to be quicker than reaching for a phone: pick the thing that happened,
 * say it in a sentence, done. The kind sets a sensible default for "are you
 * stopped" and the reporter can change it either way -- somebody who can carry
 * on while a second mower is fetched should say so.
 *
 * The two kinds that change what the client is buying say plainly what will
 * happen next, because the honest answer to "the client wants the other bed
 * doing" is *not yet*, and a crew that finds that out afterwards stops
 * reporting.
 */
export function ReportException({
  jobId,
  workSessionId = null,
  defaultKind = "cannot_perform",
}: {
  jobId: string;
  workSessionId?: string | null;
  defaultKind?: ExceptionKind;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ExceptionKind>(defaultKind);
  const [summary, setSummary] = useState("");
  const [detail, setDetail] = useState("");
  const [blocks, setBlocks] = useState(STOPS_WORK_BY_DEFAULT[defaultKind]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function pick(next: ExceptionKind) {
    setKind(next);
    setBlocks(STOPS_WORK_BY_DEFAULT[next]);
  }

  function submit() {
    setError(null);
    start(async () => {
      const result = await reportException({ jobId, kind, summary, detail, blocksWork: blocks, workSessionId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setSummary("");
      setDetail("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
      >
        <Megaphone className="h-4 w-4" /> Something came up
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <label className="block text-xs font-medium">
        What happened
        <select
          value={kind}
          onChange={(e) => pick(e.target.value as ExceptionKind)}
          className="mt-1 min-h-11 w-full rounded-md border border-border bg-background px-2 text-sm"
        >
          {EXCEPTION_KINDS.map((key) => (
            <option key={key} value={key}>
              {KIND_LABEL[key]}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">{KIND_MEANS[kind]}</p>

      {OPENS_A_CHANGE_REQUEST.includes(kind) && (
        <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200">
          This goes to the account manager as a change request. Don&apos;t start the extra work until it comes
          back approved — you&apos;ll see it on this job when it does.
        </p>
      )}

      <label className="block text-xs font-medium">
        In a sentence
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Gate padlocked, nobody answering"
          className="mt-1 min-h-11 w-full rounded-md border border-border bg-background px-2 text-sm"
        />
      </label>

      <label className="block text-xs font-medium">
        Anything else
        <textarea
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
        />
      </label>

      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={blocks} onChange={(e) => setBlocks(e.target.checked)} className="h-4 w-4" />
        We&apos;re stopped until this is sorted
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || summary.trim() === ""}
          onClick={submit}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Report it
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-11 rounded-lg px-3 text-sm text-muted-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
