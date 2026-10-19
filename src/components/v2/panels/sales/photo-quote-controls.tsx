"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askForVisit, markPhotoQuotePriced, type PhotoQuoteResult } from "@/lib/actions/photo-quote-actions";
import { savePhotoQuoteSettings, type ActionResult } from "@/lib/actions/sales-autopilot-actions";

/**
 * The interactive half of the photo quotes: the buttons on one that has come
 * in, and the owner's switch and line under Automatic.
 */

function Said({ message, failed }: { message: string | null; failed: boolean }) {
  if (!message) return null;
  return (
    <p role="status" className={`text-xs ${failed ? "text-red-700 dark:text-red-300" : "text-muted-foreground"}`}>
      {message}
    </p>
  );
}

/** "Needs a visit" and "Mark priced" on one photo quote. Pricing itself is a link, beside these. */
export function PhotoQuoteButtons({ jobId }: { jobId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<PhotoQuoteResult | null>(null);
  const run = (fn: () => Promise<PhotoQuoteResult>) => start(async () => setResult(await fn()));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" className="min-h-11" disabled={pending} onClick={() => run(() => askForVisit(jobId))}>
          Needs a visit
        </Button>
        <Button size="sm" variant="ghost" className="min-h-11" disabled={pending} onClick={() => run(() => markPhotoQuotePriced(jobId))}>
          Mark priced
        </Button>
      </div>
      <Said message={result ? (result.ok ? result.message : result.error) : null} failed={result ? !result.ok : false} />
    </div>
  );
}

/** "Quote small jobs from photos": on or off, and the line. */
export function PhotoQuoteSettingsForm({ ready, enabled, line }: { ready: boolean; enabled: boolean; line: number }) {
  const [on, setOn] = useState(enabled);
  const [amount, setAmount] = useState(String(Math.round(line)));
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  if (!ready) {
    return <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">Photo quotes aren&apos;t set up in the database yet. Every booking picks a time until they are.</p>;
  }

  return (
    <form
      className="grid gap-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await savePhotoQuoteSettings({ enabled: on, line: amount })));
      }}
    >
      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border bg-background p-3">
        <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={on} onChange={(e) => setOn(e.target.checked)} />
        <span>
          <span className="block text-sm font-semibold">Quote small jobs from photos</span>
          <span className="block text-xs text-muted-foreground">
            A client whose budget is wholly under the line skips picking a time: they tap the areas on their lot and send photos, and
            you price it from those. &ldquo;Not sure yet&rdquo; and anything over the line still book a visit.
          </span>
        </span>
      </label>
      <label className="grid max-w-xs gap-1 text-xs">
        The line, in dollars
        <Input inputMode="numeric" className="min-h-11" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" className="min-h-11" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Said message={result ? (result.ok ? result.message ?? "Saved." : result.error) : null} failed={result ? !result.ok : false} />
      </div>
    </form>
  );
}
