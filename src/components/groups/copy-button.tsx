"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Copy, and say so.
 *
 * Every piece of this feature ends in somebody pasting into Facebook, because
 * Facebook has no API left to paste on their behalf. So the copy button is not
 * a convenience here, it is the hand-off.
 */
export function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // A browser that refuses the clipboard leaves the text on screen to
          // select by hand, which is worse but not broken.
        }
      }}
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs hover:bg-accent",
        className
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}
