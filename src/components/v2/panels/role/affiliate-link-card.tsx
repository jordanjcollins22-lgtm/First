"use client";

import { useState } from "react";
import { Check, Copy, QrCode, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { copyNow, writeClipboard } from "@/lib/clipboard";

/**
 * The affiliate's own booking link: copy it, share it, or let somebody scan
 * it off the phone. Anything booked through it is credited to them.
 */
export function AffiliateLinkCard({ link, qrSvg }: { link: string | null; qrSvg: string | null }) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!link) {
    return <p className="text-sm text-muted-foreground">Your link couldn&apos;t be made just now. Reload the page to try again.</p>;
  }

  async function copy() {
    if (!link) return;
    setError(null);
    const ok = copyNow(link) || (await writeClipboard(link));
    if (!ok) return setError("Couldn't copy. Press and hold the link below to copy it.");
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function share() {
    if (!link) return;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "Free yard evaluation", text: "Book a free yard evaluation here:", url: link });
      } catch {
        // Backing out of the share sheet is not an error.
      }
      return;
    }
    await copy();
  }

  return (
    <div className="grid gap-3">
      <p className="select-all break-all rounded-lg bg-muted px-3 py-2 font-mono text-sm">{link}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" className="h-12 text-base" onClick={copy}>
          {copied ? <Check className="mr-1 h-5 w-5" /> : <Copy className="mr-1 h-5 w-5" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
        <Button type="button" variant="outline" className="h-12 text-base" onClick={share}>
          <Share2 className="mr-1 h-5 w-5" /> Share
        </Button>
      </div>
      {qrSvg && (
        <>
          <Button type="button" variant="outline" className="h-11" onClick={() => setShowQr((v) => !v)} aria-expanded={showQr}>
            <QrCode className="mr-1 h-5 w-5" /> {showQr ? "Hide QR code" : "Show QR code"}
          </Button>
          {showQr && (
            <div className="rounded-xl border bg-white p-3">
              <span className="mx-auto block w-56 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
              <p className="mt-2 text-center text-xs text-neutral-600">Let them scan it from your phone. Anything they book is yours.</p>
            </div>
          )}
        </>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
