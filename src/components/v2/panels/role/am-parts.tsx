"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Phone, Send } from "lucide-react";

import { markClientMessageDealtWith, replyToClient } from "@/lib/actions/account-manager-home-actions";

/**
 * The account manager's home screens: the pieces that need the browser.
 * Big targets, one job each, so they work on a phone at arm's length.
 */

/** A section of the home screen: a heading with its count, and what's in it. */
export function AmSection({ title, count, sub, tour, children }: { title: string; count?: number; sub: string; tour: string; children: React.ReactNode }) {
  return (
    <section data-tour={tour} className="grid gap-3 rounded-2xl border bg-card p-4">
      <div>
        <h3 className="flex items-baseline gap-2 text-lg font-bold">
          {title}
          {count != null && <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-sm font-medium">{count}</span>}
        </h3>
        <p className="text-sm text-muted-foreground">{sub}</p>
      </div>
      {children}
    </section>
  );
}

/** A tap that rings them. */
export function CallLink({ phone }: { phone: string | null }) {
  if (!phone) return <span className="text-sm text-muted-foreground">No phone on file</span>;
  return (
    <a
      href={`tel:${phone.replace(/[^\d+]/g, "")}`}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
    >
      <Phone className="h-4 w-4" aria-hidden /> Call
    </a>
  );
}

/** Answer a client's message, or say it's dealt with (you rang them instead). */
export function MessageReply({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(action: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) {
    setError(null);
    start(async () => {
      const r = await action();
      if (!r.ok) return setError(r.error);
      setDone(r.message);
      router.refresh();
    });
  }

  if (done) return <p className="text-sm font-medium text-primary">{done}</p>;
  return (
    <div className="grid gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Write back to them"
        aria-label="Your reply"
        className="w-full rounded-lg border bg-background px-3 py-2 text-base sm:text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || !text.trim()}
          onClick={() => run(() => replyToClient(jobId, text))}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Send className="h-4 w-4" aria-hidden /> {pending ? "Sending…" : "Send"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => markClientMessageDealtWith(jobId))}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border bg-background px-4 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <Check className="h-4 w-4" aria-hidden /> Dealt with
        </button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
