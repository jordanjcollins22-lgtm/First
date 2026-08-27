"use client";

import { useState, type ReactNode } from "react";

export interface PageTab {
  key: string;
  label: string;
  content: ReactNode;
  /** Left out entirely when false — a tab somebody cannot use is noise. */
  visible?: boolean;
}

/**
 * Several screens' worth of page, behind one set of tabs.
 *
 * Every tab's content is rendered and then hidden rather than swapped out, so
 * switching is instant and nothing refetches. That is what makes it safe to
 * fold pages together: a tab has to be as quick as the page it replaced, or
 * the merge has cost somebody something.
 */
export function PageTabs({ tabs, initialKey }: { tabs: PageTab[]; initialKey?: string }) {
  const shown = tabs.filter((tab) => tab.visible !== false);
  const [active, setActive] = useState(
    () => (initialKey && shown.some((t) => t.key === initialKey) ? initialKey : shown[0]?.key) ?? ""
  );

  if (shown.length === 0) return null;

  return (
    <div>
      {shown.length > 1 && (
        <div className="mb-6 inline-flex flex-wrap rounded-lg border border-border p-1">
          {shown.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                active === tab.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-primary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      {shown.map((tab) => (
        <div key={tab.key} className={active === tab.key ? "" : "hidden"}>
          {tab.content}
        </div>
      ))}
    </div>
  );
}
