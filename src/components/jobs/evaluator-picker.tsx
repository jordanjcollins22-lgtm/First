"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { reassignEvaluator } from "@/lib/actions/job-actions";

const NOBODY = "";

export interface EvaluatorOption {
  id: string;
  name: string;
}

/**
 * Who does this evaluation, and a way to change it.
 *
 * A plain select, so it works the same on a phone in a driveway as at a
 * desk. A change that would double-book somebody is refused and the reason
 * is said under it; the select goes back to who it was, rather than looking
 * changed when it was not.
 */
export function EvaluatorPicker({
  jobId,
  assignedTo,
  options,
  canChange,
  compact = false,
}: {
  jobId: string;
  assignedTo: string | null;
  options: EvaluatorOption[];
  canChange: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(assignedTo ?? NOBODY);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  const current = options.find((o) => o.id === value)?.name ?? "Nobody yet";
  if (!canChange) {
    return <span className="text-xs text-muted-foreground">{compact ? current : `Evaluator: ${current}`}</span>;
  }

  function change(next: string) {
    const previous = value;
    setValue(next);
    setMessage(null);
    startTransition(async () => {
      const result = await reassignEvaluator(jobId, next === NOBODY ? null : next);
      if (!result.ok) {
        setValue(previous);
        setMessage({ text: result.message, bad: true });
        return;
      }
      setMessage(result.message ? { text: result.message, bad: false } : null);
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        {!compact && <span>Evaluator</span>}
        <select
          value={value}
          disabled={pending}
          onChange={(e) => change(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          aria-label="Evaluator"
          className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
        >
          <option value={NOBODY}>Nobody yet</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      </label>
      {message && <span className={`max-w-xs text-xs ${message.bad ? "text-red-700" : "text-muted-foreground"}`}>{message.text}</span>}
    </span>
  );
}
