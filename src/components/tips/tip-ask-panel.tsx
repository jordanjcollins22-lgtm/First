"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";

import { dollars, type TipStatus } from "@/lib/tips";
import { askForTip, stopAskingForTip } from "@/lib/actions/tip-actions";

/**
 * Handing the client the thank-you link.
 *
 * There is no email or text going out of this system yet, so the link is
 * copied and handed over — read off a phone at the door, or pasted into
 * whatever the account manager already uses to talk to that client. That is
 * not a workaround: the moment worth asking in is the one where somebody is
 * standing in the finished garden, and a link you can show beats a message
 * that arrives on Tuesday.
 *
 * Only on a finished job. A tip request on work still running reads as a
 * demand for a deposit by another name.
 */
export function TipAskPanel({
  jobId,
  baseUrl,
  status,
  tip,
}: {
  jobId: string;
  baseUrl: string;
  /** The job's status. The ask is only offered on a finished one. */
  status: string;
  tip: { token: string; status: TipStatus; amountCents: number | null; message: string | null } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const link = tip ? `${baseUrl}/tip/${tip.token}` : null;

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — long-press the link to copy it by hand.");
    }
  }

  if (status !== "completed") {
    return (
      <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
        <h3 className="font-semibold">Thank-you link</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Available once the job is finished. Asking before then reads as a demand for a deposit by
          another name.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">Thank-you link</h3>
        {tip && <StatusChip status={tip.status} amountCents={tip.amountCents} />}
      </div>

      {!tip ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            Opens a page asking the client whether they would like to leave something for the crew.
            &ldquo;No thanks&rdquo; is a real button on it, the same size as the rest.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await askForTip(jobId);
                setError(result.ok ? null : result.message);
                if (result.ok) router.refresh();
              })
            }
            className="mt-2 min-h-9 rounded-md border border-border px-3 text-xs hover:bg-accent"
          >
            {pending ? "Opening…" : "Make a link"}
          </button>
        </>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-border bg-background px-2 py-1.5 text-xs">
              {link}
            </code>
            <button
              type="button"
              onClick={copy}
              className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border px-2.5 text-xs hover:bg-accent"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          {tip.message && (
            <p className="mt-2 rounded-md border border-border bg-background/60 p-2 text-xs">
              &ldquo;{tip.message}&rdquo;
            </p>
          )}

          {tip.status !== "paid" && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await stopAskingForTip(jobId);
                  setError(result.ok ? null : result.message);
                  if (result.ok) router.refresh();
                })
              }
              className="mt-2 text-xs text-muted-foreground underline"
            >
              Take the link down
            </button>
          )}
        </>
      )}

      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </section>
  );
}

function StatusChip({ status, amountCents }: { status: TipStatus; amountCents: number | null }) {
  const text =
    status === "paid"
      ? `${amountCents ? dollars(amountCents) : "Paid"} left`
      : status === "declined"
        ? "They said no"
        : status === "unpaid"
          ? "Card form opened"
          : "Not answered yet";

  return (
    <span
      className={
        status === "paid"
          ? "rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
          : "rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
      }
    >
      {text}
    </span>
  );
}
