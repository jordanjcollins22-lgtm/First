"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Lock } from "lucide-react";

export interface JobSection {
  id: string;
  title: string;
  /** A word or two of state, so the row is worth reading closed. */
  hint?: string | null;
  /** Draws attention: this is the thing that is due. */
  highlight?: boolean;
  /** Why it cannot be opened yet. Renders as a locked row. */
  lockedReason?: string | null;
  body: ReactNode;
}

/**
 * The job, one section at a time.
 *
 * Everything used to be on screen at once, which on a phone is a very long
 * page where the thing you came for is somewhere in the middle. Now each part
 * is a row you tap, and only the open one is mounted: closing a section
 * unmounts it, so a job with fifteen panels is never fifteen panels of live
 * DOM competing for a phone's attention.
 *
 * One at a time on purpose. Two open sections is a scroll position nobody
 * asked for, and the whole point is that you are looking at one thing.
 */
export function JobSections({
  sections,
  defaultOpen = null,
}: {
  sections: JobSection[];
  /** Usually whatever is due next, so the first tap is already done. */
  defaultOpen?: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(defaultOpen);

  return (
    <div className="flex flex-col gap-2">
      {sections.map((section) => {
        const locked = Boolean(section.lockedReason);
        const open = !locked && openId === section.id;

        return (
          <section
            key={section.id}
            className={`overflow-hidden rounded-xl border backdrop-blur-md ${
              open
                ? "border-primary/40 bg-card/80"
                : section.highlight
                  ? "border-primary/30 bg-primary/5"
                  : "border-white/60 bg-card/60"
            }`}
          >
            <button
              type="button"
              disabled={locked}
              onClick={() => setOpenId(open ? null : section.id)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left disabled:cursor-default"
            >
              {locked && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-sm font-semibold ${
                    locked ? "text-muted-foreground" : ""
                  }`}
                >
                  {section.title}
                </span>
                {(section.lockedReason || section.hint) && (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {section.lockedReason ?? section.hint}
                  </span>
                )}
              </span>
              {!locked && (
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                    open ? "rotate-180" : ""
                  }`}
                />
              )}
            </button>

            {/* Unmounted when closed, not hidden. A hidden panel still costs
                a phone everything except the pixels. */}
            {open && <div className="border-t border-border/60 px-4 py-4">{section.body}</div>}
          </section>
        );
      })}
    </div>
  );
}
