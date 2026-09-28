"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface DaySquare {
  key: string;
  title: string;
  /** What is waiting in it; nothing is shown for none. */
  count: number;
  line: string;
}

/**
 * An account manager's day: three squares, like The system's, each with
 * what is waiting in it. Tapping one opens it underneath, straight away,
 * with no trip to the server; the address remembers which, so a refresh
 * keeps it open.
 */
export function AccountManagerDayView({
  squares,
  initialOpen,
  sections,
  preview = false,
}: {
  squares: DaySquare[];
  initialOpen: string | null;
  sections: Record<string, ReactNode>;
  /** For The system's preview: the address is left alone. */
  preview?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(initialOpen);

  function pick(key: string) {
    setOpen(key);
    if (!preview) {
      const url = new URL(window.location.href);
      url.searchParams.set("open", key);
      window.history.replaceState(null, "", url);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className={cn("grid gap-2", squares.length >= 3 ? "grid-cols-3" : "grid-cols-2")}>
        {squares.map((sq) => (
          <li key={sq.key}>
            <button
              type="button"
              onClick={() => pick(sq.key)}
              aria-pressed={open === sq.key}
              className={cn(
                "flex h-full min-h-28 w-full flex-col justify-between rounded-2xl border p-3 text-left transition-colors",
                open === sq.key ? "border-primary bg-primary/10 shadow-sm" : "border-border bg-card/80 hover:border-primary/60"
              )}
            >
              <span className="text-sm font-semibold leading-tight">{sq.title}</span>
              <span>
                {sq.count > 0 && <span className="block text-3xl font-bold leading-none text-primary">{sq.count}</span>}
                <span className="mt-1 block text-xs leading-snug text-muted-foreground">{sq.line}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && sections[open] ? (
        <section>{sections[open]}</section>
      ) : (
        <p className="text-center text-sm text-muted-foreground">Nothing waiting on you. Tap a square to open it.</p>
      )}
    </div>
  );
}
