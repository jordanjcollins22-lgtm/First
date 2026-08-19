import Link from "next/link";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getDashboard } from "@/lib/data/dashboard";
import { RANGES, type DashboardData, type DashboardRange } from "@/lib/dashboard";
import { getActivity } from "@/lib/data/activity";
import type { ActivityItem } from "@/lib/activity";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { DashboardSections } from "@/components/dashboard/dashboard-sections";
import { ActivityFeed } from "@/components/dashboard/activity-feed";

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function isRange(value: string | undefined): value is DashboardRange {
  return RANGES.some((r) => r.key === value);
}

/**
 * The whole business on one screen, for one window of time.
 *
 * The window is a URL parameter rather than component state, so switching it
 * is a fresh server render with fresh numbers. A client-side toggle over
 * already-fetched data would show this morning's figures all afternoon, which
 * on a dashboard is worse than showing nothing.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("dashboard", "/attractors");

  const { range: requested } = await searchParams;
  const range: DashboardRange = isRange(requested) ? requested : "today";

  let data: DashboardData | null = null;
  try {
    data = await getDashboard(range);
  } catch (err) {
    console.error("Dashboard failed to load:", err);
  }

  // The feed is the nice-to-have here; the piles are the point. It loads on
  // its own so a missing table costs an empty section, not the page.
  let activity: ActivityItem[] = [];
  if (data) {
    activity = await getActivity(data.window.start, data.window.end).catch((err) => {
      console.error("Activity failed to load:", err);
      return [];
    });
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
        <h1 className="mb-1 text-2xl font-bold">Dashboard</h1>
        <p className="rounded-xl border border-white/60 bg-card/60 p-4 text-sm text-muted-foreground backdrop-blur-md">
          Couldn&apos;t load the business right now. Reload the page, and if it keeps happening check{" "}
          <Link href="/admin/database" className="underline">
            Database setup
          </Link>
          .
        </p>
      </div>
    );
  }

  const { summary } = data;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="mb-4 text-muted-foreground">Everything happening, and everything about to.</p>

      {/* Plain links, so the window survives a reload and can be bookmarked. */}
      <nav className="mb-4 flex gap-1 rounded-xl border border-white/60 bg-card/60 p-1 backdrop-blur-md">
        {RANGES.map((r) => (
          <Link
            key={r.key}
            href={`/dashboard?range=${r.key}`}
            aria-current={r.key === range ? "page" : undefined}
            className={`flex-1 rounded-lg px-3 py-2.5 text-center text-sm font-medium ${
              r.key === range ? "bg-primary text-primary-foreground" : "hover:bg-accent/50"
            }`}
          >
            {r.label}
          </Link>
        ))}
      </nav>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label="Visits still to do"
          value={String(summary.evaluationsDue)}
          hint={summary.overdue > 0 ? `${summary.overdue} overdue` : undefined}
          alert={summary.overdue > 0}
        />
        <Tile label="Jobs on site" value={String(summary.jobsOnSite)} />
        <Tile
          label="Needs sign-off"
          value={String(summary.needsSignoff)}
          hint={summary.needsSignoff > 0 ? "Work finished, never closed" : undefined}
          alert={summary.needsSignoff > 0}
        />
        <Tile label="Booked value" value={money(summary.bookedValue)} hint={data.window.label} />
      </div>

      <ActivityFeed items={activity} showDays={range !== "today"} />

      <DashboardSections
        title="Evaluations"
        blurb="Going out to look at it. Anything still outstanding from before this window is pulled in and marked late."
        sections={data.evaluations}
      />

      <DashboardSections
        title="Jobs"
        blurb="The work itself. Sold-but-unbooked and sign-off piles ignore the window — they matter whenever they exist."
        sections={data.jobs}
      />

      <p className="mt-4 text-xs text-muted-foreground">
        Every pile is read from the job&apos;s own status, its evaluation and its proposal rather than stored
        separately, so this can never disagree with the job itself. Tap any row to open it.
      </p>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  alert,
}: {
  label: string;
  value: string;
  hint?: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 backdrop-blur-md ${
        alert ? "border-amber-400/70 bg-amber-50/70" : "border-white/60 bg-card/60"
      }`}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
