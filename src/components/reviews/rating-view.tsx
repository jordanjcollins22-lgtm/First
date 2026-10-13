"use client";

import { useState, useTransition } from "react";
import { Loader2, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { submitFeedback, submitRating, type RatingAsk } from "@/lib/actions/public-rating-actions";

/**
 * One tap, 1 to 5. A five opens the Google review page; below five asks
 * what to fix. The Google link is always on the page once they have rated,
 * whatever they rated.
 */
export function RatingView({ token, ask }: { token: string; ask: RatingAsk }) {
  const [rating, setRating] = useState<number | null>(ask.rating);
  const [route, setRoute] = useState<"google" | "owner" | "thanks" | null>(
    ask.rating == null ? null : ask.rating === 5 && ask.googleLink ? "google" : ask.rating < 5 ? "owner" : "thanks"
  );
  const [feedback, setFeedback] = useState(ask.feedback ?? "");
  const [sent, setSent] = useState(Boolean(ask.feedback));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function rate(n: number) {
    setError(null);
    start(async () => {
      const result = await submitRating(token, n);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setRating(n);
      setRoute(result.route);
      // Straight on to Google: the moment they are happiest is the moment to ask.
      if (result.route === "google" && result.googleLink) window.location.href = result.googleLink;
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-12">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">{ask.businessName}</p>
        <h1 className="mt-1 text-2xl font-bold">{ask.clientFirstName ? `${ask.clientFirstName}, how did we do?` : "How did we do?"}</h1>
      </div>

      {route == null ? (
        <>
          <div className="flex justify-center gap-2" role="radiogroup" aria-label="Rating, 1 to 5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} out of 5`}
                disabled={pending}
                onClick={() => rate(n)}
                className="flex min-h-14 min-w-14 flex-col items-center justify-center rounded-xl border bg-card hover:bg-muted disabled:opacity-60"
              >
                <Star className="h-6 w-6 text-amber-500" fill="currentColor" />
                <span className="text-sm font-semibold">{n}</span>
              </button>
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground">1 is poor, 5 is excellent.</p>
          {pending && <Loader2 className="mx-auto h-5 w-5 animate-spin" />}
        </>
      ) : route === "owner" ? (
        <div className="flex flex-col gap-3">
          <p className="text-center">Thank you for telling us. What should we have done better?</p>
          {sent ? (
            <p className="rounded-xl border bg-card p-4 text-center text-sm">Thank you. The owner reads every one of these and will be in touch.</p>
          ) : (
            <>
              <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={4} placeholder="What went wrong, or what would have made it a 5?" />
              <Button
                type="button"
                className="min-h-11"
                disabled={pending || !feedback.trim()}
                onClick={() =>
                  start(async () => {
                    const r = await submitFeedback(token, feedback);
                    if (r.ok) setSent(true);
                    else setError(r.message);
                  })
                }
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send to the owner"}
              </Button>
            </>
          )}
        </div>
      ) : (
        <p className="rounded-xl border bg-card p-4 text-center">
          Thank you!{" "}
          {route === "google" && ask.googleLink ? (
            <a className="font-semibold underline" href={ask.googleLink}>
              Leave your review on Google
            </a>
          ) : null}
        </p>
      )}

      {route === "owner" && ask.googleLink && (
        <p className="text-center text-xs text-muted-foreground">
          You&apos;re also welcome to{" "}
          <a className="underline" href={ask.googleLink}>
            leave a public review on Google
          </a>
          .
        </p>
      )}
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
    </main>
  );
}
