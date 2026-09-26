import { Suspense, type ReactNode } from "react";

/**
 * Loads a tab's content without holding up the page.
 *
 * A module page used to await each of its tabs in turn before sending
 * anything, so the page took as long as all of its tabs added together, and
 * Operations waited on the weather service before showing the calendar.
 * Wrapped in this, each tab loads alongside the others and arrives on its
 * own: the header and the tab bar show at once, and a slow tab only holds up
 * itself.
 */
export function Deferred({ load, fallback }: { load: () => Promise<ReactNode>; fallback?: ReactNode }) {
  return (
    <Suspense fallback={fallback ?? <TabLoading />}>
      <Loaded load={load} />
    </Suspense>
  );
}

async function Loaded({ load }: { load: () => Promise<ReactNode> }) {
  return <>{await load()}</>;
}

/** The shape of a tab while its content is on the way. */
export function TabLoading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      <div className="h-5 w-48 animate-pulse rounded bg-muted" />
      <div className="h-24 w-full animate-pulse rounded-lg bg-muted" />
      <div className="h-24 w-full animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
