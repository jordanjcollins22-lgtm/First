"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import type { FinderLive } from "@/lib/data/finder-live";

const REFRESH_MS = 20_000;

const ago = (iso: string | null, now: number) => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

const PILE: Record<FinderLive["latest"][number]["pile"], { label: string; className: string }> = {
  request: { label: "Asking for work", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  business: { label: "Business ad", className: "bg-muted text-muted-foreground" },
  other: { label: "Other", className: "bg-muted text-muted-foreground" },
  sorting: { label: "Sorting…", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
};

/**
 * The finder as it runs: whether the browser is on, where it is looking,
 * today's counts, and the newest posts it read. Refreshes itself every 20
 * seconds while the page is open.
 */
export function FinderLiveCard({ initial }: { initial: FinderLive }) {
  const [live, setLive] = useState(initial);
  // Starts at the moment the numbers were read, so the server and the
  // browser draw the same "ago" and the clock takes over after.
  const [now, setNow] = useState(() => new Date(initial.at).getTime());
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let stopped = false;
    const pull = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/outreach/agent/live", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as FinderLive;
        if (!stopped) {
          setLive(next);
          setStale(false);
        }
      } catch {
        if (!stopped) setStale(true);
      }
    };
    const poll = setInterval(pull, REFRESH_MS);
    const tickClock = () => setNow(Date.now());
    const first = setTimeout(tickClock, 0);
    const clock = setInterval(tickClock, 5_000);
    document.addEventListener("visibilitychange", pull);
    return () => {
      stopped = true;
      clearInterval(poll);
      clearTimeout(first);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", pull);
    };
  }, []);

  const tiles = [
    { label: "Posts read", value: live.today.read },
    { label: "Asking for work", value: live.today.requests },
    { label: "Sent to the board", value: live.today.onBoard },
    { label: "Answered", value: live.today.answered },
  ];

  return (
    <section className="rounded-2xl border border-border bg-card p-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${live.online ? "animate-pulse bg-emerald-500" : "bg-zinc-400"}`} aria-hidden />
          {live.online ? "Live: the finder is running" : "The finder's browser isn't checking in"}
        </h2>
        <span className="text-xs text-muted-foreground">
          {stale ? "Couldn't refresh, trying again" : `Updated ${ago(live.at, now)}`}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {live.look ? `Last looked at ${live.look.name ?? "Facebook"} ${ago(live.look.at, now)}, read ${live.look.posts ?? 0} posts.` : "No look yet."}
        {!live.online && ` Browser last seen ${ago(live.seenAt, now)}. Check Chrome is open on the PC with the finder turned on.`}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl bg-muted/50 px-3 py-2">
            <p className="text-2xl font-bold tabular-nums">{t.value}</p>
            <p className="text-[11px] text-muted-foreground">{t.label} today</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs">
        <Link href="/admin/outreach/posts" className="font-medium text-primary hover:underline">
          {live.waiting} waiting on the board for a responder
        </Link>
        <span className="text-muted-foreground"> · {live.today.businesses} business ads kept for later</span>
      </p>

      {live.latest.length > 0 && (
        <ul className="mt-3 divide-y divide-border/60 border-t border-border/60">
          {live.latest.map((p) => (
            <li key={p.id} className="flex flex-col gap-0.5 py-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className={`rounded-full px-2 py-0.5 font-medium ${PILE[p.pile].className}`}>{PILE[p.pile].label}</span>
                {p.pile === "request" && !p.hasLink && <span className="text-amber-700">no link yet, so not on the board</span>}
                <span className="text-muted-foreground">
                  {ago(p.at, now)}
                  {p.group ? ` · ${p.group}` : ""}
                </span>
              </div>
              <p className="line-clamp-2 text-sm">{p.text}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
