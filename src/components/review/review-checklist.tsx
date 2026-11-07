"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, X } from "lucide-react";

import { decodeReview, type ReviewList } from "@/lib/review-link";

const LIST_KEY = "flow-review";
const TICKS_KEY = "flow-review-ticks";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: the checklist still works for this page.
  }
}

/**
 * The Flow Board's checklist, on top of the app. Shows only when somebody
 * arrived from a review link (?review=...), and stays across pages until
 * they close it, so they can walk the steps screen by screen.
 */
export function ReviewChecklist() {
  const [list, setList] = useState<ReviewList | null>(null);
  const [ticks, setTicks] = useState<boolean[]>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const fromLink = decodeReview(new URLSearchParams(window.location.search).get("review"));
    const stored = read<ReviewList>(LIST_KEY);
    const next = fromLink ?? stored;
    if (fromLink && JSON.stringify(fromLink) !== JSON.stringify(stored)) {
      write(LIST_KEY, fromLink);
      write(TICKS_KEY, []);
    }
    // Reading the link and storage once, after the first paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setList(next);
    setTicks(read<boolean[]>(TICKS_KEY) ?? []);
  }, []);

  if (!list) return null;
  const done = list.steps.filter((_, i) => ticks[i]).length;
  const toggle = (i: number) => {
    const next = list.steps.map((_, j) => Boolean(ticks[j]));
    next[i] = !next[i];
    setTicks(next);
    write(TICKS_KEY, next);
  };
  const close = () => {
    write(LIST_KEY, null);
    write(TICKS_KEY, null);
    setList(null);
  };

  return (
    <aside className="fixed bottom-3 right-3 z-50 w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-border bg-card/95 shadow-xl backdrop-blur" aria-label="Review checklist">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <CheckCircle2 className="h-4 w-4 text-primary" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{list.title}</p>
        <span className="text-xs text-muted-foreground">
          {done} of {list.steps.length}
        </span>
        <button type="button" onClick={() => setOpen(!open)} className="text-muted-foreground" aria-label={open ? "Hide checklist" : "Show checklist"}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
        <button type="button" onClick={close} className="text-muted-foreground" aria-label="Close checklist">
          <X className="h-4 w-4" />
        </button>
      </div>
      {open && (
        <ol className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto p-3">
          {list.steps.map((s, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={Boolean(ticks[i])} onChange={() => toggle(i)} aria-label={`Looks good: ${s.step}`} />
              <div className="min-w-0 flex-1">
                <p className={ticks[i] ? "text-muted-foreground line-through" : "font-medium"}>{s.step}</p>
                {s.how && <p className="text-xs text-muted-foreground">{s.how}</p>}
                {s.path && (
                  <a href={s.path} className="text-xs font-medium text-primary">
                    Show me this screen
                  </a>
                )}
              </div>
            </li>
          ))}
          {done === list.steps.length && (
            <li className="rounded-lg bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              All checked. Go back to the Flow Board and press Approve.
            </li>
          )}
        </ol>
      )}
    </aside>
  );
}
