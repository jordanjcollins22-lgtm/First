/** Shown under the four-page bar while a page reads its live numbers. */
export default function Loading() {
  return (
    <div className="pb-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="mb-4 h-4 w-72 animate-pulse rounded-md bg-muted/70" />
      <div className="mb-4 h-9 w-56 animate-pulse rounded-md bg-muted" />
      <div className="mb-5 h-14 animate-pulse rounded-xl border bg-card/40" />
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl border bg-card/40" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
    </div>
  );
}
