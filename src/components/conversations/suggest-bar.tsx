"use client";

import { useState, useTransition } from "react";
import { Sparkles, X } from "lucide-react";

import { suggestReplies } from "@/lib/actions/suggest-reply-actions";

/**
 * Drafts of what to say next, above the composer.
 *
 * It suggests and stops. Tapping one puts the words in the box, where they
 * can be edited or deleted like anything typed there — nothing is sent, and
 * nothing is booked, until a person presses send. The two things it pushes
 * at are the two things that stall a job: a quote nobody answered and a date
 * nobody pinned down.
 *
 * Behind a button rather than loaded with the page. Most of the time somebody
 * opening a thread already knows what to say, and a suggestion nobody asked
 * for is a paragraph in the way of the message they came to write.
 */
export function SuggestBar({
  jobId,
  onPick,
}: {
  jobId: string;
  onPick: (text: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function ask() {
    setError(null);
    start(async () => {
      const result = await suggestReplies(jobId);
      if (result.ok) setSuggestions(result.suggestions);
      else setError(result.message);
    });
  }

  if (suggestions === null) {
    return (
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={ask}
          disabled={pending}
          className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {pending ? "Thinking…" : "Suggest a reply"}
        </button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }

  return (
    <div className="mb-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Tap one to edit it — nothing sends until you do
        </span>
        <button
          type="button"
          onClick={() => setSuggestions(null)}
          className="text-muted-foreground"
          aria-label="Hide suggestions"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {suggestions.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing worth suggesting on this one.</p>
      ) : (
        suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onPick(suggestion)}
            className="rounded-xl border border-border bg-card/70 px-3 py-2 text-left text-sm hover:bg-accent/40"
          >
            {suggestion}
          </button>
        ))
      )}

      <button
        type="button"
        onClick={ask}
        disabled={pending}
        className="self-start text-xs font-semibold text-primary disabled:opacity-50"
      >
        {pending ? "Thinking…" : "Try again"}
      </button>
    </div>
  );
}
