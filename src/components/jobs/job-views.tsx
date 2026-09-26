"use client";

import { useState, type ReactNode } from "react";

/**
 * The job board's views as chips inside one tab.
 *
 * They were five tabs of their own: five clicks to find a job that could be
 * in any of them. Now they are one tab, the counts are on the chips, and the
 * chip that is open is in the address as `?view=`, so a link to "what is
 * stuck" still lands on it.
 */
export interface JobView {
  key: string;
  label: string;
  count: number;
  blurb: string;
  content: ReactNode;
}

export function JobViews({ views, initial }: { views: JobView[]; initial?: string | null }) {
  const [active, setActive] = useState(views.some((v) => v.key === initial) ? initial! : views[0]?.key);
  const open = views.find((v) => v.key === active) ?? views[0];

  function choose(key: string) {
    setActive(key);
    const url = new URL(window.location.href);
    url.searchParams.set("view", key);
    window.history.replaceState(null, "", url);
  }

  if (!open) return null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {views.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => choose(v.key)}
            className={`rounded-full border px-3 py-1 text-xs ${v.key === open.key ? "border-foreground bg-foreground text-background" : "border-border"}`}
          >
            {v.label} ({v.count})
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{open.blurb}</p>
      {open.content}
    </div>
  );
}
