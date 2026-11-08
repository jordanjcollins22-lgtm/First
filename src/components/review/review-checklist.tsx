"use client";

import { useCallback, useEffect, useState } from "react";
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

/** A step's path is "/screen#spot": the screen to open and the id of the spot to outline on it. */
function splitPath(path: string | undefined): { pathname: string; spot: string } {
  const [pathname, hash] = String(path || "").split("#");
  return { pathname: pathname || "", spot: hash ? decodeURIComponent(hash) : "" };
}

type Box = { top: number; left: number; width: number; height: number };

/**
 * The Flow Board's checklist, on top of the app. Shows only when somebody
 * arrived from a review link (?review=...), and stays across pages until
 * they close it, so they can walk the steps screen by screen. Clicking a
 * step outlines the spot on the screen it is about.
 */
export function ReviewChecklist() {
  const [list, setList] = useState<ReviewList | null>(null);
  const [ticks, setTicks] = useState<boolean[]>([]);
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState<number | null>(null);
  const [spot, setSpot] = useState("");
  const [box, setBox] = useState<Box | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const fromLink = decodeReview(new URLSearchParams(window.location.search).get("review"));
    const stored = read<ReviewList>(LIST_KEY);
    const next = fromLink ?? stored;
    if (fromLink && JSON.stringify(fromLink) !== JSON.stringify(stored)) {
      write(LIST_KEY, fromLink);
      write(TICKS_KEY, []);
    }
    const nextTicks = read<boolean[]>(TICKS_KEY) ?? [];
    // Reading the link and storage once, after the first paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setList(next);
    setTicks(nextTicks);
    if (!next) return;
    // Start on the step this screen is about: the one the #hash names, else the first one left to check here.
    const here = window.location.pathname;
    const hash = decodeURIComponent(window.location.hash.slice(1));
    const onThisScreen = next.steps
      .map((s, i) => ({ i, ...splitPath(s.path) }))
      .filter((s) => s.pathname === here && s.spot);
    const pick = onThisScreen.find((s) => s.spot === hash) ?? onThisScreen.find((s) => !nextTicks[s.i]) ?? onThisScreen[0];
    if (pick) {
      setActive(pick.i);
      setSpot(pick.spot);
    } else if (hash) {
      setSpot(hash);
    }
  }, []);

  // Draw the outline around the spot, and keep it on the spot while the page scrolls or the spot loads in.
  useEffect(() => {
    if (!spot) return;
    let frame = 0;
    let scrolled = false;
    const started = Date.now();
    const follow = () => {
      const el = document.getElementById(spot);
      if (el) {
        if (!scrolled) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          scrolled = true;
        }
        const r = el.getBoundingClientRect();
        setBox((b) =>
          b && b.top === r.top && b.left === r.left && b.width === r.width && b.height === r.height
            ? b
            : { top: r.top, left: r.left, width: r.width, height: r.height },
        );
        setMissing(false);
      } else {
        setBox(null);
        // The spot may still be loading: say so only after a few seconds.
        setMissing(Date.now() - started > 4000);
      }
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [spot]);

  const show = useCallback(
    (i: number) => {
      if (!list) return;
      const s = list.steps[i];
      const { pathname, spot: id } = splitPath(s?.path);
      setActive(i);
      if (pathname && pathname !== window.location.pathname) {
        // Another screen: open it there, and the outline is drawn when it loads.
        window.location.assign(s.path as string);
        return;
      }
      if (id) history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${encodeURIComponent(id)}`);
      setMissing(false);
      setBox(null);
      setSpot(id);
    },
    [list],
  );

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
    setSpot("");
    setBox(null);
  };

  return (
    <>
      {box && (
        <div
          aria-hidden
          data-review-outline-box=""
          className="pointer-events-none fixed z-40 rounded-lg"
          style={{
            top: box.top - 6,
            left: box.left - 6,
            width: box.width + 12,
            height: box.height + 12,
            border: "3px solid #f59e0b",
            boxShadow: "0 0 0 6px rgba(245,158,11,.25)",
          }}
        />
      )}
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
              <li key={i} className={`flex gap-2 rounded-lg p-1 text-sm ${active === i ? "bg-amber-100/70 ring-2 ring-amber-400 dark:bg-amber-900/30" : ""}`}>
                <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={Boolean(ticks[i])} onChange={() => toggle(i)} aria-label={`Looks good: ${s.step}`} />
                <button type="button" onClick={() => show(i)} className="min-w-0 flex-1 text-left" disabled={!s.path}>
                  <p className={ticks[i] ? "text-muted-foreground line-through" : "font-medium"}>{s.step}</p>
                  {s.how && <p className="text-xs text-muted-foreground">{s.how}</p>}
                  {s.path && <p className="text-xs font-medium text-primary">{active === i && box ? "Outlined on the page" : "Show me where"}</p>}
                  {active === i && missing && <p className="text-xs text-amber-700 dark:text-amber-300">Not on the screen yet. ItThis spot isn&apos;t on this screen.apos;s outlined once it shows up.</p>}
                </button>
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
    </>
  );
}
