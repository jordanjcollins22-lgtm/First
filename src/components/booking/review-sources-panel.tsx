"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { removeReviewSource, requestReviewPull, saveReviewSource } from "@/lib/actions/booking-proof-actions";
import { PLATFORM_LABEL } from "@/lib/review-import";
import type { ReviewSource } from "@/lib/data/review-sources";

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
}

/**
 * Paste the business's Facebook page and Google listing, and the reviews
 * come in on their own: the Chrome extension reads them, and only the
 * five-star ones with something written are kept.
 */
export function ReviewSourcesPanel({
  sources,
  extensionBehind,
  expectedVersion,
}: {
  sources: ReviewSource[];
  /** The extension last seen reading is older than the one that can pull reviews. */
  extensionBehind: boolean;
  expectedVersion: string;
}) {
  const router = useRouter();
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      after?.();
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">Pull reviews from your pages</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Paste your Facebook page and your Google Maps listing. Only 5-star reviews with something written go on the booking
        page; nothing lower ever does. They&apos;re checked again every week, so new ones come in on their own.
      </p>

      <ul className="mb-3 flex flex-col gap-2">
        {sources.map((s) => {
          const waiting = !s.pulledAt || (s.pullRequestedAt != null && s.pullRequestedAt > s.pulledAt);
          return (
            <li key={s.id} className="rounded-xl border border-border p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-medium">{PLATFORM_LABEL[s.platform]}</span>
                  <a href={s.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-primary underline">
                    {s.url}
                  </a>
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  disabled={pending}
                  aria-label={`Stop pulling from ${PLATFORM_LABEL[s.platform]}`}
                  onClick={() => run(() => removeReviewSource(s.id))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className={`mt-1 text-xs ${waiting ? "text-amber-700" : "text-muted-foreground"}`}>
                {waiting
                  ? "Waiting for the extension. Keep Chrome open, signed in to this app and to Facebook; it reads within a minute or two."
                  : `${when(s.pulledAt)}: ${s.lastResult ?? "Read."}`}
              </p>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="facebook.com/yourpage or your Google Maps link"
          inputMode="url"
        />
        <Button type="button" disabled={pending || !link.trim()} onClick={() => run(() => saveReviewSource(link), () => setLink(""))}>
          {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Add
        </Button>
      </div>
      {sources.length > 0 && (
        <Button type="button" variant="outline" size="sm" className="mt-2" disabled={pending} onClick={() => run(() => requestReviewPull())}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Pull reviews now
        </Button>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {extensionBehind && (
        <p className="mt-2 text-xs text-amber-700">
          The Chrome extension needs updating to v{expectedVersion} to read reviews. Download it on Where Posts Come From,
          under Install the extension.
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Instagram doesn&apos;t have reviews, so there&apos;s nothing to pull from it. On Google Maps, open your business and press
        Share to get the link.
      </p>
    </section>
  );
}
