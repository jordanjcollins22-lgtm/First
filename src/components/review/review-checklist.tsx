"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, X } from "lucide-react";

import { decodeReview, type ReviewList, type ReviewStep } from "@/lib/review-link";

const LIST_KEY = "flow-review";
const TICKS_KEY = "flow-review-ticks";
const ANSWERS_KEY = "flow-review-answers";

/** One-tap reasons for a No; Jordan can also type his own. */
const NO_REASONS = ["Doesn't work", "Looks wrong", "Not what I asked for", "Missing something", "Hard to understand"];

type Answer = { verdict: "yes" | "no"; why?: string; state: "sending" | "sent" | "failed"; error?: string };

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

/** Steps grouped by the board task they belong to, in order. Steps with no task form their own group. */
function groupsOf(steps: ReviewStep[]): { card?: string; task?: string; items: { s: ReviewStep; i: number }[] }[] {
  const groups: { card?: string; task?: string; items: { s: ReviewStep; i: number }[] }[] = [];
  steps.forEach((s, i) => {
    const last = groups[groups.length - 1];
    if (last && last.card === s.card) last.items.push({ s, i });
    else groups.push({ card: s.card, task: s.task, items: [{ s, i }] });
  });
  return groups;
}

type Box = { top: number; left: number; width: number; height: number };

/**
 * The Flow Board's checklist, on top of the app. Shows only when somebody
 * arrived from a review link (?review=...), and stays across pages until
 * they close it, so they can walk the steps screen by screen. Clicking a
 * step outlines the spot on the screen it is about. Each board task gets a
 * Yes or No (No asks why), sent straight back to the board that opened this
 * page: Yes approves the task, No puts a fix on the board.
 */
export function ReviewChecklist() {
  const [list, setList] = useState<ReviewList | null>(null);
  const [ticks, setTicks] = useState<boolean[]>([]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState<number | null>(null);
  const [spot, setSpot] = useState("");
  const [box, setBox] = useState<Box | null>(null);
  const [missing, setMissing] = useState(false);
  const [askingWhy, setAskingWhy] = useState<string | null>(null);
  const [why, setWhy] = useState("");

  useEffect(() => {
    const fromLink = decodeReview(new URLSearchParams(window.location.search).get("review"));
    const stored = read<ReviewList>(LIST_KEY);
    const next = fromLink ?? stored;
    if (fromLink && JSON.stringify(fromLink) !== JSON.stringify(stored)) {
      write(LIST_KEY, fromLink);
      write(TICKS_KEY, []);
      write(ANSWERS_KEY, {});
    }
    const nextTicks = read<boolean[]>(TICKS_KEY) ?? [];
    // Reading the link and storage once, after the first paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setList(next);
    setTicks(nextTicks);
    setAnswers(read<Record<string, Answer>>(ANSWERS_KEY) ?? {});
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

  // The board answers each Yes or No it receives, so we can say it arrived.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!window.opener || e.source !== window.opener) return;
      const d = e.data as { type?: unknown; card?: unknown; ok?: unknown; error?: unknown };
      if (d?.type !== "flow-review-ack" || typeof d.card !== "string") return;
      const card = d.card;
      setAnswers((all) => {
        const a = all[card];
        if (!a) return all;
        const next = { ...all, [card]: { ...a, state: d.ok ? "sent" : "failed", error: typeof d.error === "string" ? d.error.slice(0, 200) : undefined } as Answer };
        write(ANSWERS_KEY, next);
        return next;
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
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

  const send = (card: string, task: string, verdict: "yes" | "no", reason?: string) => {
    const opener = window.opener as Window | null;
    const answer: Answer = { verdict, why: reason, state: "sending" };
    const next = { ...answers, [card]: answer };
    setAnswers(next);
    write(ANSWERS_KEY, next);
    setAskingWhy(null);
    setWhy("");
    if (!opener || opener.closed) {
      const failed = { ...next, [card]: { ...answer, state: "failed", error: "The Flow Board isn't open. Open this page with View this change on the board, and keep the board open." } as Answer };
      setAnswers(failed);
      write(ANSWERS_KEY, failed);
      return;
    }
    opener.postMessage({ type: "flow-review-answer", card, task, verdict, why: reason }, "*");
    // No answer from the board in a few seconds means it didn't arrive.
    setTimeout(() => {
      setAnswers((all) => {
        if (all[card]?.state !== "sending") return all;
        const n = { ...all, [card]: { ...all[card], state: "failed", error: "The Flow Board didn't answer. Is it still open in the tab you came from?" } as Answer };
        write(ANSWERS_KEY, n);
        return n;
      });
    }, 6000);
  };

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
  const groups = groupsOf(list.steps);
  const tasks = groups.filter((g) => g.card);
  const answered = tasks.filter((g) => answers[g.card as string]?.state === "sent").length;

  const stepEl = ({ s, i }: { s: ReviewStep; i: number }) => (
    <li key={i} className={`flex gap-2 rounded-lg p-1 text-sm ${active === i ? "bg-amber-100/70 ring-2 ring-amber-400 dark:bg-amber-900/30" : ""}`}>
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={Boolean(ticks[i])} onChange={() => toggle(i)} aria-label={`Looked at: ${s.step}`} />
      <button type="button" onClick={() => show(i)} className="min-w-0 flex-1 text-left" disabled={!s.path}>
        <p className={ticks[i] ? "text-muted-foreground line-through" : "font-medium"}>{s.step}</p>
        {s.how && <p className="text-xs text-muted-foreground">{s.how}</p>}
        {s.path && <p className="text-xs font-medium text-primary">{active === i && box ? "Outlined on the page" : "Show me where"}</p>}
        {active === i && missing && <p className="text-xs text-amber-700 dark:text-amber-300">Not on the screen yet. It&apos;s outlined once it shows up.</p>}
      </button>
    </li>
  );

  const verdictEl = (card: string, task: string) => {
    const a = answers[card];
    if (a && a.state !== "failed") {
      return (
        <p className={`rounded-md px-2 py-1 text-xs font-medium ${a.verdict === "yes" ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200"}`}>
          {a.state === "sending" ? "Sending to the Flow Board…" : a.verdict === "yes" ? "Yes sent: approved on the Flow Board." : `No sent: it's on the Flow Board to fix. Why: ${a.why}`}
        </p>
      );
    }
    return (
      <div className="space-y-2">
        {a?.state === "failed" && <p className="text-xs font-medium text-red-700 dark:text-red-300">Not sent. {a.error}</p>}
        <div className="flex gap-2">
          <button type="button" className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-semibold text-white" onClick={() => send(card, task, "yes")}>
            Yes
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1 text-sm font-semibold"
            aria-expanded={askingWhy === card}
            onClick={() => {
              setAskingWhy(askingWhy === card ? null : card);
              setWhy("");
            }}
          >
            No
          </button>
        </div>
        {askingWhy === card && (
          <div className="space-y-2 rounded-md border border-border p-2">
            <p className="text-sm font-medium">Why not?</p>
            <div className="flex flex-wrap gap-1">
              {NO_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`rounded-full border px-2 py-0.5 text-xs ${why === r ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
                  onClick={() => setWhy(r)}
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              className="w-full rounded-md border border-border bg-background p-2 text-sm"
              rows={2}
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              placeholder="Or say what's wrong in your own words"
            />
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              disabled={!why.trim()}
              onClick={() => send(card, task, "no", why.trim().slice(0, 500))}
            >
              Send No
            </button>
          </div>
        )}
      </div>
    );
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
      <aside className="fixed bottom-3 right-3 z-50 w-[min(24rem,calc(100vw-1.5rem))] rounded-xl border border-border bg-card/95 shadow-xl backdrop-blur" aria-label="Review checklist">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">{list.title}</p>
          <span className="text-xs text-muted-foreground">{tasks.length ? `${answered} of ${tasks.length} answered` : `${done} of ${list.steps.length}`}</span>
          <button type="button" onClick={() => setOpen(!open)} className="text-muted-foreground" aria-label={open ? "Hide checklist" : "Show checklist"}>
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
          <button type="button" onClick={close} className="text-muted-foreground" aria-label="Close checklist">
            <X className="h-4 w-4" />
          </button>
        </div>
        {open && (
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto p-3">
            {groups.map((g, n) => (
              <section key={n} className={g.card ? "space-y-2 rounded-lg border border-border/70 p-2" : "space-y-2"}>
                {g.card && g.task && <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{tasks.length > 1 ? `Task ${tasks.indexOf(g) + 1}: ` : ""}{g.task}</p>}
                <ol className="flex flex-col gap-2">{g.items.map(stepEl)}</ol>
                {g.card && verdictEl(g.card, g.task || list.title)}
              </section>
            ))}
            {tasks.length > 0 && answered === tasks.length && (
              <p className="rounded-lg bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                Every task is answered. Tap anywhere on the Flow Board to send it all to Claude.
              </p>
            )}
            {tasks.length === 0 && done === list.steps.length && (
              <p className="rounded-lg bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                All checked. Go back to the Flow Board and press Approve.
              </p>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
