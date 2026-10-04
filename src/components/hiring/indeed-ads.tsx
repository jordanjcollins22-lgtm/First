"use client";

import { useState } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";

type Ad = { key: string; title: string; body: string; payFields: string; applyUrl: string; needsPay: boolean };

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
      {ads.map((ad) => (
        <details key={ad.key} className="group rounded-xl border border-border bg-card">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
            <span className="flex-1 font-medium">{ad.title}</span>
            {ad.needsPay && (
              <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                <AlertTriangle className="h-3 w-3" /> Add pay first
              </span>
            )}
          </summary>
          <div className="space-y-2 border-t border-border p-3">
            {ad.needsPay && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                The pay for this job isn&apos;t set yet, so the ad says &quot;[ADD PAY RANGE BEFORE POSTING]&quot;. Maryland job ads have to show the pay.
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
      ))}
    </div>
  );
}
