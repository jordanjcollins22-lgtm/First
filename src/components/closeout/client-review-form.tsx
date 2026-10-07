"use client";

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { respondToClientReview } from "@/lib/actions/client-review-actions";

/**
 * Approve, or say what is not right. Saying what is not right needs the
 * words, because "no" on its own gives the crew nothing to fix.
 */
export function ClientReviewForm({
  token,
  status,
  note,
  superseded,
  hasPhotos,
}: {
  token: string;
  status: "sent" | "approved" | "changes";
  note: string | null;
  superseded: boolean;
  hasPhotos: boolean;
}) {
  const [answered, setAnswered] = useState<"approved" | "changes" | null>(status === "sent" ? null : status);
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (superseded) {
    return (
      <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
        We sent you a newer version of these photos after fixing things up. Please use the most recent email.
      </p>
    );
  }

  if (answered === "approved") {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-5 text-center">
        <CheckCircle2 className="h-9 w-9 text-primary" />
        <p className="text-lg font-semibold">Approved. Thank you.</p>
        <p className="text-sm text-muted-foreground">We are glad you are happy with it.</p>
      </div>
    );
  }

  if (answered === "changes") {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm">
        <p className="font-semibold">Thank you for telling us.</p>
        {note && <p className="mt-1 text-muted-foreground">&ldquo;{note}&rdquo;</p>}
        <p className="mt-1 text-muted-foreground">We will be in touch to put it right, then send you the new photos.</p>
      </div>
    );
  }

  if (!hasPhotos) return null;

  function answer(decision: "approved" | "changes") {
    setError(null);
    start(async () => {
      const result = await respondToClientReview(token, decision, decision === "changes" ? text : null);
      if (!result.ok) return setError(result.message);
      setAnswered(decision);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  return (
    <section className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
      {asking ? (
        <>
          <label htmlFor="what-is-wrong" className="text-sm font-medium">
            What isn&apos;t right?
          </label>
          <Textarea
            id="what-is-wrong"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="The edging by the front steps, for example."
          />
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setAsking(false)} disabled={pending}>
              Back
            </Button>
            <Button type="button" className="flex-1" onClick={() => answer("changes")} disabled={pending || !text.trim()}>
              {pending ? "Sending…" : "Send"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Button type="button" className="h-12 text-base" onClick={() => answer("approved")} disabled={pending}>
            {pending ? "Saving…" : "Approve"}
          </Button>
          <Button type="button" variant="outline" onClick={() => setAsking(true)} disabled={pending}>
            Something isn&apos;t right
          </Button>
        </>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
