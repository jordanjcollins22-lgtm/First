"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AdCheck } from "@/lib/hiring/ad-review";

type Ad = { key: string; title: string; body: string; payFields: string; applyUrl: string; needsPay: boolean; checks?: AdCheck[] };

/** Each job's ad, with a button to copy the title and one for the description. */
export function IndeedAds({ ads }: { ads: Ad[] }) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="grid gap-3">
      {ads.map((ad) => {
        const failing = (ad.checks ?? []).filter((c) => !c.passed);
        // An ad that fails a check isn't shown to post until it passes: only what's missing.
        if (failing.length > 0 || ad.needsPay) {
          const missing = [...(ad.needsPay ? ["Says the pay"] : []), ...failing.map((c) => c.label)].filter((l, i, all) => all.indexOf(l) === i);
          return (
            <div key={ad.key} className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {ad.title}: this ad isn&apos;t ready yet
              </p>
              <ul className="mt-1 list-disc pl-6 text-xs">
                {missing.map((m) => (
                  <li key={m}>
                    {m}
                    {failing.find((c) => c.label === m)?.fix ? `: ${failing.find((c) => c.label === m)!.fix}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        return (
          <details key={ad.key} className="group rounded-xl border border-border bg-card">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
              <span className="flex-1 font-medium">{ad.title}</span>
              <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">
                <Check className="h-3 w-3" /> Ready to post
              </span>
            </summary>
            <div className="space-y-2 border-t border-border p-3">
              {ad.checks && ad.checks.length > 0 && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  ✓ Passed all {ad.checks.length} checks: {ad.checks.map((c) => c.label.toLowerCase()).join(", ")}.
                </p>
              )}
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 font-sans text-sm">{ad.body}</pre>
              <p className="whitespace-pre-line rounded-lg border border-border px-3 py-2 text-xs">
                <span className="font-semibold">In Indeed&apos;s pay and benefits sections:</span> {ad.payFields}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => copy(`${ad.key}-title`, ad.title)}>
                  {copied === `${ad.key}-title` ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />} Copy title
                </Button>
                <Button type="button" size="sm" onClick={() => copy(`${ad.key}-body`, ad.body)}>
                  {copied === `${ad.key}-body` ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />} Copy description
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => copy(`${ad.key}-link`, ad.applyUrl)}>
                  {copied === `${ad.key}-link` ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />} Copy apply link
                </Button>
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}
