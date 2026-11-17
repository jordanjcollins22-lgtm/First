"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { copyNow, writeClipboard } from "@/lib/clipboard";

/** One link with a copy button, the personal part of it in bold. */
export function CopyLine({ link, personal }: { link: string; personal?: string | null }) {
  const [copied, setCopied] = useState(false);
  const at = personal ? link.lastIndexOf(personal) : -1;
  async function copy() {
    const ok = copyNow(link) || (await writeClipboard(link));
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="flex items-center gap-2">
      <p className="min-w-0 flex-1 select-all break-all rounded-lg bg-muted px-3 py-2 font-mono text-sm">
        {at >= 0 && personal ? (
          <>
            {link.slice(0, at)}
            <strong className="text-primary">{personal}</strong>
            {link.slice(at + personal.length)}
          </>
        ) : (
          link
        )}
      </p>
      <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={copy} aria-label="Copy link">
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}
