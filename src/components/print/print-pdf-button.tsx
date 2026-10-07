"use client";

import { useState, useTransition } from "react";
import { Loader2, Printer } from "lucide-react";

import { cn } from "@/lib/utils";
import { canShareFile, deliveryFor, fileNameFrom, isStandalone } from "@/lib/pdf-delivery";

/**
 * Getting a generated sheet onto paper, from a phone.
 *
 * A plain link to the PDF works on a desktop and fails on a phone in the one
 * way nobody notices until they try to print: the app is installed to a home
 * screen, so it runs with no browser chrome, and the PDF opens in a window
 * with no toolbar, no share button and no print. The document is right there
 * and there is no way to get it out.
 *
 * So the file is fetched and handed to the operating system's own share sheet,
 * which has Print on it and does not care whether there is a browser around it.
 * Where that is not available the file is downloaded instead, because a PDF in
 * Files can be printed and a PDF in a chrome-less window cannot.
 *
 * The save link beside it stays. This does several things that can each fail
 * on somebody's particular phone, and a plain link that always works is worth
 * keeping next to it.
 */
export function PrintPdfButton({
  href,
  label = "Print",
  fallbackName = "sheet.pdf",
  className,
}: {
  /** The route that generates the PDF. */
  href: string;
  label?: string;
  /** Used only if the server sends no filename. */
  fallbackName?: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function handle() {
    setError(null);

    // Asked before the fetch, so the answer does not depend on how long the
    // sheet took to draw. Sharing is checked with a stand-in file of the same
    // type, which is what canShare actually inspects.
    const probe =
      typeof File === "function" ? new File([new Blob()], fallbackName, { type: "application/pdf" }) : null;
    const route = deliveryFor({
      canShare: Boolean(probe) && canShareFile(navigator, probe),
      standalone: isStandalone(window),
      touch: typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
    });

    if (route === "open") {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }

    setWorking(true);
    try {
      const response = await fetch(href, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const name = fileNameFrom(response.headers.get("content-disposition"), fallbackName);
      const file = new File([blob], name, { type: "application/pdf" });

      if (route === "share" && canShareFile(navigator, file)) {
        try {
          await navigator.share({ files: [file], title: name });
          return;
        } catch (shareError) {
          // Backing out of the share sheet is not a failure and must not be
          // reported as one. Anything else falls through to the download,
          // which is the point of having both.
          if (shareError instanceof DOMException && shareError.name === "AbortError") return;
        }
      }

      save(blob, name);
    } catch {
      setError("Couldn't build the sheet. Try the save link instead.");
    } finally {
      setWorking(false);
    }
  }

  const busy = pending || working;

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => startTransition(handle)}
        className={cn(
          "flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60",
          className
        )}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
        {busy ? "Getting it ready…" : label}
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Put the file where the device keeps files, and let it take over from there. */
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Freed on the next turn rather than immediately: revoking it in the same
  // task can cancel a download that has only just started.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
