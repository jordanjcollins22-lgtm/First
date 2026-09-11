"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, FileText, Send } from "lucide-react";

import { issueReceipt, markReceiptSent } from "@/lib/actions/receipt-actions";

/**
 * One payment's receipt: write it, hand it over, say it went.
 *
 * Three small buttons rather than a form, because the whole job is thirty
 * seconds long and happens with a client waiting. Write it. Copy the link
 * into whatever you already talk to them on. Mark it sent so the list stops
 * asking.
 *
 * The link is built from the browser's own origin rather than passed down,
 * so it is right on the preview deployment and on the real domain without
 * anybody threading a base URL through four components.
 */
export function ReceiptControl({
  paymentId,
  number,
  token,
  sentAt,
}: {
  paymentId: string;
  number: string | null;
  token: string | null;
  sentAt: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const link = token && typeof window !== "undefined" ? `${window.location.origin}/receipt/${token}` : null;

  function write() {
    setError(null);
    start(async () => {
      const result = await issueReceipt(paymentId);
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Open it and copy the address by hand.");
    }
  }

  function sent() {
    start(async () => {
      const result = await markReceiptSent(paymentId);
      if (!result.ok) setError(result.message ?? "Couldn't mark that.");
      else router.refresh();
    });
  }

  if (!number || !token) {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={write}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] font-semibold hover:bg-accent disabled:opacity-50"
        >
          <FileText className="h-3 w-3" />
          {pending ? "Writing…" : "Write receipt"}
        </button>
        {error && <span className="text-[11px] text-destructive">{error}</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[11px] font-semibold text-foreground">{number}</span>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-accent"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy link"}
      </button>
      <a
        href={`/receipt/${token}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-accent"
      >
        <ExternalLink className="h-3 w-3" />
        Open
      </a>
      {sentAt ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
          <Check className="h-3 w-3" />
          Sent
        </span>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={sent}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-accent disabled:opacity-50"
        >
          <Send className="h-3 w-3" />
          Mark sent
        </button>
      )}
      {error && <span className="text-[11px] text-destructive">{error}</span>}
    </span>
  );
}
