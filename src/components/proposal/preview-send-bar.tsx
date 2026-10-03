"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { sendProposalToClient } from "@/lib/actions/proposal-actions";

/**
 * At the bottom of the office's preview of a proposal: the send. The price
 * was accepted on My Day; this is the look at it as the client will see it,
 * and then Send to client, here, once it has been read.
 */
export function PreviewSendBar({ jobId, sendTo, sentAt }: { jobId: string; sendTo: string | null; sentAt: string | null }) {
  const [pending, start] = useTransition();
  const [sent, setSent] = useState<string | null>(sentAt ? (sendTo ?? "the client") : null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="sticky bottom-0 z-40 border-t border-border bg-card/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] backdrop-blur">
      <div className="mx-auto flex max-w-2xl flex-col gap-2">
        {sent ? (
          <>
            <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> Sent to {sent}.
            </p>
            <Link href="/my-day" className="inline-flex h-11 items-center justify-center rounded-md border border-border font-semibold">
              Back to My Day
            </Link>
          </>
        ) : (
          <>
            <Button
              type="button"
              className="h-14 text-base font-semibold"
              disabled={pending || !sendTo}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const result = await sendProposalToClient(jobId);
                  if (result.ok) setSent(result.to);
                  else setError(result.error);
                })
              }
            >
              {pending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Send className="mr-2 h-5 w-5" />}
              Send to client
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              {sendTo ? `It emails to ${sendTo}.` : "No email on file. Copy this page's link and text it to them."}
            </p>
          </>
        )}
        {error && <p className="text-center text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
