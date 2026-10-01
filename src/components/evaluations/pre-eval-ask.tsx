"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { previewPreEvalAsk, sendPreEvalAsk } from "@/lib/actions/pre-eval-ask-actions";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

type Preview = { to: string; subject: string; body: string };

/**
 * On an evaluation card whose client has not filled out the pre-eval: one
 * button, then the email word for word, then Send. Nothing goes until Send.
 */
export function PreEvalAsk({ jobId, askedAt }: { jobId: string; askedAt: string | null }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [sending, startSending] = useTransition();

  function open() {
    setError(null);
    setDone(null);
    startLoading(async () => {
      const result = await previewPreEvalAsk(jobId);
      if (!result.ok) return setError(result.message);
      setPreview({ to: result.to, subject: result.subject, body: result.body });
    });
  }

  function send() {
    setError(null);
    startSending(async () => {
      const result = await sendPreEvalAsk(jobId);
      if (!result.ok) return setError(result.message);
      setDone(result.message);
      setPreview(null);
      router.refresh();
    });
  }

  if (!preview) {
    return (
      <div className="mt-2 flex flex-col gap-1">
        {done ? (
          <p className="text-xs font-medium text-emerald-700">{done}</p>
        ) : askedAt ? (
          <p className="text-xs text-muted-foreground">Pre-eval form emailed at {time(askedAt)}.</p>
        ) : null}
        <button
          type="button"
          onClick={open}
          disabled={loading}
          className="flex h-9 items-center justify-center gap-1.5 self-start rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-70"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
          {askedAt || done ? "Email the pre-eval form again" : "Email them the pre-eval form"}
        </button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-muted/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">This email goes to the client</p>
        <button type="button" onClick={() => setPreview(null)} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="rounded-lg border border-border bg-background p-3 text-sm">
        <p className="text-xs text-muted-foreground">
          To: <span className="text-foreground">{preview.to}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Subject: <span className="font-medium text-foreground">{preview.subject}</span>
        </p>
        <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{preview.body}</p>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" onClick={send} disabled={sending} className="h-10 flex-1 font-semibold">
          {sending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Send email
        </Button>
        <Button type="button" variant="outline" onClick={() => setPreview(null)} className="h-10">
          Cancel
        </Button>
      </div>
    </div>
  );
}
