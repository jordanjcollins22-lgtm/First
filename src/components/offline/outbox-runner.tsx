"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CloudOff, Loader2, RotateCcw, Trash2, UploadCloud, X } from "lucide-react";

import { OUTBOX_CHANGED, OUTBOX_SENT, localPreview, outboxItems, removeItem, updateItem, type OutboxItem } from "@/lib/offline/outbox";
import { sendItem } from "@/lib/offline/outbox-send";
import { cookieSaysDemo } from "@/lib/demo-guard";
import { cn } from "@/lib/utils";

/** Tries this many times before saying it couldn't be sent. No-signal tries don't count. */
const MAX_ATTEMPTS = 5;

/**
 * Sends what was kept on the phone with no signal, by itself, as soon as
 * there is signal again: when the phone comes back online, when the app is
 * opened again, and every so often in between. On every page, so a photo
 * taken on the crew sheet is sent even if the crew sheet was closed.
 *
 * And says so, in one small bar at the top: no signal, how much is waiting,
 * and anything that was refused, with a way to try again or let it go.
 */
export function OutboxRunner() {
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [online, setOnline] = useState(true);
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(false);
  const running = useRef(false);

  const reload = useCallback(async () => {
    setItems(await outboxItems().catch(() => []));
  }, []);

  const run = useCallback(async () => {
    if (running.current || !navigator.onLine) return;
    // A demo sends nothing, and a photo waiting from before it keeps waiting
    // rather than using up its tries on the demo's refusals.
    if (cookieSaysDemo(document.cookie)) return;
    running.current = true;
    let sentAny = false;
    try {
      const now = Date.now();
      const waiting = (await outboxItems().catch(() => [])).filter((i) => !i.failed && (i.nextTryAt ?? 0) <= now);
      if (waiting.length > 0) setSending(true);
      for (const item of waiting) {
        const outcome = await sendItem(item);
        if (outcome.ok) {
          await removeItem(item.id);
          window.dispatchEvent(new CustomEvent(OUTBOX_SENT, { detail: { item, result: outcome.result } }));
          sentAny = true;
          continue;
        }
        // Lost the signal again: stop, and pick up where this left off.
        if (outcome.noSignal) break;
        // Refused, or the server had a moment: tried again after 30 seconds,
        // then 1, 2 and 4 minutes, before it is called couldn't upload.
        const attempts = item.attempts + 1;
        await updateItem({ ...item, attempts, nextTryAt: Date.now() + 30_000 * 2 ** (attempts - 1), failed: attempts >= MAX_ATTEMPTS ? outcome.message : null });
      }
    } finally {
      running.current = false;
      setSending(false);
      if (sentAny) router.refresh();
    }
  }, [router]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setOnline(navigator.onLine);
      void reload();
      void run();
    }, 0);

    // The service worker keeps the field pages openable with no signal.
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    let soon: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      void reload();
      if (soon) clearTimeout(soon);
      soon = setTimeout(() => void run(), 1500);
    };
    const onOnline = () => {
      setOnline(true);
      void run();
    };
    const onOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    window.addEventListener(OUTBOX_CHANGED, onChange);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    const every = setInterval(() => void run(), 20_000);
    return () => {
      clearTimeout(timer);
      if (soon) clearTimeout(soon);
      clearInterval(every);
      window.removeEventListener(OUTBOX_CHANGED, onChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload, run]);

  // Each page opened with signal is kept on the phone, with the files it
  // loaded, so it opens again with no signal. The worker keeps only field pages.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const timer = setTimeout(() => {
      void navigator.serviceWorker.ready.then((registration) => {
        const assets = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((name) => name.includes("/_next/static/"));
        registration.active?.postMessage({ type: "keep", page: window.location.pathname + window.location.search, assets });
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [pathname]);

  const failed = items.filter((i) => i.failed);
  const waiting = items.length - failed.length;
  if (online && items.length === 0) return null;

  const things = (n: number, list: OutboxItem[]) => {
    const photos = list.every((i) => i.blob);
    return `${n} ${photos ? (n === 1 ? "photo" : "photos") : n === 1 ? "thing" : "things"}`;
  };
  const line = !online
    ? waiting > 0
      ? `No signal · ${things(waiting, items)} saved on this phone. They upload by themselves when there's signal.`
      : "No signal. Photos you take are saved on this phone and upload by themselves."
    : failed.length > 0
      ? `${things(failed.length, failed)} couldn't upload. Tap to see.`
      : sending
        ? `Uploading ${things(waiting, items)} saved with no signal…`
        : `${things(waiting, items)} waiting to upload.`;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[70] flex flex-col items-center gap-2 px-3">
      <button
        type="button"
        onClick={() => items.length > 0 && setOpen((v) => !v)}
        className={cn(
          "pointer-events-auto flex max-w-md items-center gap-2 rounded-full px-3.5 py-2 text-left text-xs font-medium shadow-lg",
          failed.length > 0 && online ? "bg-destructive text-destructive-foreground" : online ? "bg-primary text-primary-foreground" : "bg-slate-900 text-white"
        )}
      >
        {!online ? <CloudOff className="h-4 w-4 shrink-0" /> : sending ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <UploadCloud className="h-4 w-4 shrink-0" />}
        <span>{line}</span>
      </button>

      {open && items.length > 0 && (
        <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-border bg-card p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">Saved on this phone</p>
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </div>
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {items.map((item) => {
              const preview = localPreview(typeof item.args.path === "string" ? item.args.path : item.id);
              return (
                <li key={item.id} className="flex items-center gap-2.5 rounded-xl border border-border p-2">
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover" />
                  ) : (
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted">
                      <UploadCloud className="h-5 w-5 text-muted-foreground" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block truncate font-medium">{item.label}</span>
                    <span className={cn("block text-xs", item.failed ? "text-destructive" : "text-muted-foreground")}>
                      {item.failed ?? (online ? "Uploading soon" : "Waiting for signal")}
                    </span>
                  </span>
                  {item.failed && (
                    <button
                      type="button"
                      aria-label="Try again"
                      onClick={async () => {
                        await updateItem({ ...item, attempts: 0, nextTryAt: 0, failed: null });
                        void run();
                      }}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Delete it from this phone"
                    onClick={async () => {
                      if (window.confirm("Delete this from the phone? It hasn't been uploaded, so it will be gone.")) await removeItem(item.id);
                    }}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
