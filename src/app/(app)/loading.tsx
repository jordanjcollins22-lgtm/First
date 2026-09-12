/**
 * What the app shows while a page is being built.
 *
 * There was nothing here before, which meant every navigation showed the old
 * screen — or a blank one on a cold open — until the entire server render had
 * finished. Seven seconds of that is indistinguishable from a broken app, and
 * it is the same seven seconds whether the page is slow or the network is.
 *
 * With this, the header and the nav paint immediately and the page streams in
 * underneath. Nothing about the total time changes; what changes is that the
 * person can see the app is theirs and is working, which is most of what
 * "fast" actually means to somebody holding a phone in a yard.
 *
 * Deliberately vague: three grey blocks that suggest a page without promising
 * a particular one. A skeleton that mimics one screen is wrong on every other
 * screen, and a wrong skeleton reads worse than an honest blank.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-7 w-40 animate-pulse rounded-md bg-muted" />
      <div className="mt-2 h-4 w-64 animate-pulse rounded-md bg-muted/70" />
      <div className="mt-6 space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl border border-border/60 bg-card/40"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
