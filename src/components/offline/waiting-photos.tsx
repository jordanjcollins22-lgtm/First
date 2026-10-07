"use client";

import { useEffect, useRef, useState } from "react";
import { CloudOff } from "lucide-react";

import { OUTBOX_CHANGED, OUTBOX_SENT, waitingFor, type OutboxItem } from "@/lib/offline/outbox";

export type WaitingItem = OutboxItem & { preview: string | null };

/** What this page has waiting on the phone, kept up to date as it is sent. */
export function useWaiting(scope: string): WaitingItem[] {
  const [items, setItems] = useState<WaitingItem[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => void waitingFor(scope).then((next) => live && setItems(next)).catch(() => {});
    const timer = setTimeout(load, 0);
    window.addEventListener(OUTBOX_CHANGED, load);
    return () => {
      live = false;
      clearTimeout(timer);
      window.removeEventListener(OUTBOX_CHANGED, load);
    };
  }, [scope]);
  return items;
}

/** Told when something from this page is sent, with what the send came back with. */
export function useOnSent(scope: string, handle: (item: OutboxItem, result: Record<string, unknown>) => void) {
  const latest = useRef(handle);
  useEffect(() => {
    latest.current = handle;
  });
  useEffect(() => {
    const listener = (event: Event) => {
      const { item, result } = (event as CustomEvent<{ item: OutboxItem; result: Record<string, unknown> }>).detail;
      if (item.scope === scope) latest.current(item, result);
    };
    window.addEventListener(OUTBOX_SENT, listener);
    return () => window.removeEventListener(OUTBOX_SENT, listener);
  }, [scope]);
}

/**
 * The photos from this page still on the phone, where they were taken, so
 * nobody takes one again thinking it was lost.
 */
export function WaitingPhotos({ scope, filter }: { scope: string; filter?: (item: OutboxItem) => boolean }) {
  const items = useWaiting(scope).filter((item) => (filter ? filter(item) : true));
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-slate-400 bg-slate-50 p-2 dark:bg-slate-900/40">
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) =>
          item.preview ? (
            <span key={item.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.preview} alt={item.label} className="h-16 w-16 rounded-md object-cover opacity-80" />
              <CloudOff className="absolute right-1 top-1 h-4 w-4 rounded-full bg-slate-900/70 p-0.5 text-white" />
            </span>
          ) : null
        )}
      </div>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <CloudOff className="h-3.5 w-3.5 shrink-0" />
        {items.length === 1 ? "1 photo saved on this phone. It uploads by itself" : `${items.length} photos saved on this phone. They upload by themselves`} when there&apos;s signal.
      </p>
    </div>
  );
}
