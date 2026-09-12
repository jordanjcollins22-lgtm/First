"use client";

import { useEffect, useRef, useState } from "react";

import { renderBeforeAfter } from "@/lib/social-canvas";

interface Drawn {
  blob: Blob;
  url: string;
}

/**
 * Squares that have already been drawn.
 *
 * Module-level so the same pair is never drawn twice: the list draws it, and
 * when somebody opens it the dialog gets the one the list already made. That
 * is also why the preview can be trusted — the file the list shows is the
 * file that gets uploaded, not another render of the same inputs.
 */
const cache = new Map<string, Drawn>();

/** Drawing is not free on a phone. Old previews are let go once the list is
 * long enough that nobody is scrolling back to them. */
const MAX_CACHED = 60;

function remember(key: string, drawn: Drawn) {
  cache.set(key, drawn);
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    const evicted = cache.get(oldest);
    if (evicted) URL.revokeObjectURL(evicted.url);
    cache.delete(oldest);
  }
}

export interface Composite {
  url: string | null;
  blob: Blob | null;
  error: string | null;
}

/**
 * Draws a pair, once, when it is asked for.
 *
 * `enabled` is what keeps a list of forty pairs from drawing forty squares on
 * load — the row turns it on when it scrolls into view.
 */
export function useComposite(
  key: string,
  beforeUrl: string | null,
  afterUrl: string | null,
  enabled: boolean
): Composite {
  const [drawn, setDrawn] = useState<Drawn | null>(() => cache.get(key) ?? null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!enabled || started.current) return;

    if (!beforeUrl || !afterUrl) {
      started.current = true;
      // Async so the state lands after the effect rather than inside it.
      void Promise.resolve().then(() => setError("One of the photos wouldn't load."));
      return;
    }

    started.current = true;
    let cancelled = false;

    // A hit still resolves through the promise: one path in, one place the
    // state is set, and no synchronous set inside the effect.
    const cached = cache.get(key);
    const work = cached
      ? Promise.resolve(cached)
      : renderBeforeAfter({ beforeUrl, afterUrl }).then((blob) => {
          const made = { blob, url: URL.createObjectURL(blob) };
          remember(key, made);
          return made;
        });

    work
      .then((made) => {
        if (!cancelled) setDrawn(made);
      })
      .catch((err) => {
        if (cancelled) return;
        started.current = false;
        setError(err instanceof Error ? err.message : "Couldn't draw that one.");
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, key, beforeUrl, afterUrl]);

  return { url: drawn?.url ?? null, blob: drawn?.blob ?? null, error };
}

/** True once the element has been on screen. Never goes back to false — a
 * square that has been drawn stays drawn. */
export function useOnScreen<T extends Element>(ref: React.RefObject<T | null>): boolean {
  // No observer (an old browser, a test) means draw it rather than never —
  // decided at mount, so there is nothing for an effect to correct.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      // A screen's worth of warning, so a preview is ready by the time it
      // arrives rather than appearing after it.
      { rootMargin: "400px" }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, seen]);

  return seen;
}
