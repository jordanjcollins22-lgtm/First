"use client";

import { useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";

import { previewProposalEmail, type EmailPreview } from "@/lib/actions/proposal-actions";

/**
 * The email Send to client sends, shown before it goes: who it is from, who
 * it is to, the subject and every word of it, as the client's inbox will
 * show it. Written by the same code as the real send, so nothing here can
 * differ from what arrives.
 */
export function ProposalEmailPreview({ jobId, sample }: { jobId: string; sample?: EmailPreview }) {
  const [email, setEmail] = useState<EmailPreview | null>(sample ?? null);

  useEffect(() => {
    if (sample) return;
    let live = true;
    previewProposalEmail(jobId)
      .then((result) => live && setEmail(result))
      .catch(() => live && setEmail({ ok: false, error: "Couldn't load the email. Reload the page to see it before sending." }));
    return () => {
      live = false;
    };
  }, [jobId, sample]);

  if (!email) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Writing the email…
      </div>
    );
  }
  if (!email.ok) {
    return email.noEmail ? null : <p className="rounded-xl border border-border p-3 text-sm text-destructive">{email.error}</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-white text-sm text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-b border-border bg-muted/50 px-3 py-2 text-xs">
        <dt className="text-muted-foreground">From</dt>
        <dd className="break-all">{email.from ?? "Not set up yet: Settings → Email"}</dd>
        <dt className="text-muted-foreground">To</dt>
        <dd className="break-all">{email.to}</dd>
        {email.replyTo && (
          <>
            <dt className="text-muted-foreground">Replies to</dt>
            <dd className="break-all">{email.replyTo}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Subject</dt>
        <dd className="font-semibold">{email.subject}</dd>
      </dl>
      <div className="whitespace-pre-wrap break-words px-3 py-3 leading-relaxed">
        {email.text.split("\n").map((line, i) =>
          /^https?:\/\/\S+$/.test(line.trim()) ? (
            <a key={i} href={line.trim()} target="_blank" rel="noopener noreferrer" className="block break-all text-primary underline underline-offset-2">
              {line.trim()}
            </a>
          ) : (
            <span key={i} className="block min-h-[1.25em]">
              {line}
            </span>
          )
        )}
      </div>
    </div>
  );
}

/** Says what the card is showing, above the email. */
export function EmailHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      <Mail className="h-3.5 w-3.5" /> {children}
    </p>
  );
}
