"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Hand } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getOrCreatePreEvalLink } from "@/lib/actions/pre-eval-actions";
import type { PreEvalSummary } from "@/lib/data/pre-evals";

/** Job workspace section: copy the client's pre-eval link and see if they've filled it in. */
export function PreEvalPanel({ jobId, preEval }: { jobId: string; preEval: PreEvalSummary | null }) {
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleCopy() {
    startTransition(async () => {
      const id = preEval?.id ?? (await getOrCreatePreEvalLink(jobId));
      const url = `${window.location.origin}/pre-eval/${id}`;
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        window.prompt("Copy this link for the client:", url);
      }
    });
  }

  let status = "Send the client this link so they can tap the areas they want worked on.";
  if (preEval?.submittedAt) {
    const count = preEval.taps.length;
    status = `Client marked ${count} ${count === 1 ? "spot" : "spots"} (orange pins) on ${new Date(
      preEval.submittedAt
    ).toLocaleDateString()}.`;
  } else if (preEval) {
    status = "Link created. The client hasn't sent their spots yet.";
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border p-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Hand className="h-4 w-4" /> Client pre-eval
        </p>
        <Button type="button" size="sm" variant="secondary" disabled={isPending} onClick={handleCopy}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{status}</p>
    </div>
  );
}
