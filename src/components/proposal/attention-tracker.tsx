"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

import { recordProposalEvents } from "@/lib/actions/public-proposal-actions";

/**
 * Measuring what the client actually read, from their own browser.
 *
 * Two things are measured and they are measured differently on purpose.
 *
 * Time on a section is accumulated while that section is genuinely on screen,
 * using an intersection observer and a clock. It cannot be worked out from
 * scroll position: a page flicked from top to bottom in one movement has put
 * every section on screen and tells you nothing about any of them. It also
 * stops accumulating when the tab is hidden, because a proposal left open in
 * a background tab overnight is not somebody reading it.
 *
 * A click is recorded as it happens, since there are few of them and each one
 * is a decision rather than a movement.
 *
 * Everything is batched. A client scrolling a long proposal produces a
 * measurement every time a section leaves the screen, and a network round trip
 * for each would be slower for them and noisier for us than the thing being
 * measured. The queue is flushed on a timer, when the tab is hidden, and when
 * the page goes away, because the most interesting session is the one that
 * ends with the client closing the tab and picking up the phone.
 *
 * Nothing here blocks rendering and every failure is swallowed. A quote that
 * would not open because an analytics write failed is a far worse outcome than
 * not knowing what they looked at.
 */

interface Queued {
  kind: "section" | "click";
  target: string;
  label: string | null;
  seconds: number;
  at: string;
}

interface Attention {
  /** Record a press. Cheap, called from an onClick. */
  click: (target: string, label?: string | null) => void;
  /** Start and stop the clock on a section as it enters and leaves. */
  watch: (element: Element | null, target: string, label?: string | null) => () => void;
}

const AttentionContext = createContext<Attention | null>(null);

/** How often the queue goes out while somebody is still reading. */
const FLUSH_MS = 15_000;

/** Shorter than this on screen is a scroll past, not a read. Never sent. */
const MIN_SECONDS = 1;

export function AttentionProvider({
  token,
  preview = false,
  children,
}: {
  token: string;
  preview?: boolean;
  children: ReactNode;
}) {
  const queue = useRef<Queued[]>([]);
  const sending = useRef(false);

  const flush = useCallback(
    (force = false) => {
      if (preview) {
        queue.current = [];
        return;
      }
      if (queue.current.length === 0) return;
      if (sending.current && !force) return;

      const batch = queue.current;
      queue.current = [];
      sending.current = true;
      void recordProposalEvents({ token, preview, events: batch })
        .catch(() => {})
        .finally(() => {
          sending.current = false;
        });
    },
    [token, preview]
  );

  const push = useCallback((event: Queued) => {
    queue.current.push(event);
  }, []);

  const click = useCallback(
    (target: string, label?: string | null) => {
      push({ kind: "click", target, label: label ?? null, seconds: 0, at: new Date().toISOString() });
      // Sent promptly rather than on the next tick of the timer. A click is
      // often the last thing that happens before the tab closes.
      flush();
    },
    [push, flush]
  );

  /**
   * Run the clock on one element while it is on screen.
   *
   * Returns its own teardown, so a section that unmounts mid read still
   * reports the time it had. Without that, a client who taps a photo and
   * navigates away loses the whole reading of the section they were in.
   */
  const watch = useCallback(
    (element: Element | null, target: string, label?: string | null) => {
      if (!element || typeof IntersectionObserver === "undefined") return () => {};

      let since: number | null = null;
      let banked = 0;

      const stop = () => {
        if (since == null) return;
        banked += (Date.now() - since) / 1000;
        since = null;
      };

      const report = () => {
        stop();
        if (banked >= MIN_SECONDS) {
          push({
            kind: "section",
            target,
            label: label ?? null,
            seconds: Math.round(banked),
            at: new Date().toISOString(),
          });
        }
        banked = 0;
      };

      const observer = new IntersectionObserver(
        ([entry]) => {
          // Half on screen, so a heading peeking over the fold does not start
          // a clock on a section nobody is reading yet.
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            if (since == null) since = Date.now();
          } else {
            report();
          }
        },
        { threshold: [0, 0.5, 1] }
      );
      observer.observe(element);

      // A tab in the background is not somebody reading. Banking the time on
      // hide and restarting on show is the difference between a client who
      // studied the price and one who left the tab open overnight.
      const onVisibility = () => {
        if (document.visibilityState === "hidden") report();
      };
      document.addEventListener("visibilitychange", onVisibility);

      return () => {
        observer.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        report();
      };
    },
    [push]
  );

  useEffect(() => {
    if (preview) return;
    const timer = setInterval(() => flush(), FLUSH_MS);

    // The last flush matters most: the session that ends with the tab closing
    // is usually the one just before the client rings.
    const onHide = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", () => flush(true));

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHide);
      flush(true);
    };
  }, [flush, preview]);

  const value = useMemo<Attention>(() => ({ click, watch }), [click, watch]);

  return <AttentionContext.Provider value={value}>{children}</AttentionContext.Provider>;
}

/**
 * Attention, wherever the proposal is being drawn.
 *
 * Falls back to doing nothing rather than throwing when there is no provider,
 * so a component of the proposal rendered anywhere else, in a preview or in a
 * test, still renders.
 */
export function useAttention(): Attention {
  return (
    useContext(AttentionContext) ?? {
      click: () => {},
      watch: () => () => {},
    }
  );
}

/**
 * One measured section of the page.
 *
 * A plain wrapper rather than something clever, because the thing being
 * measured is "was this part of the page in front of them", and that is a
 * property of a box on screen.
 */
export function Watched({
  section,
  label,
  className,
  children,
}: {
  section: string;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const { watch } = useAttention();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => watch(ref.current, section, label ?? null), [watch, section, label]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
