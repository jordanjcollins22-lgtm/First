import Link from "next/link";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { getDashboard } from "@/lib/data/dashboard";
import { getCommissionFor } from "@/lib/data/commission";
import type { DashboardData } from "@/lib/dashboard";
import type { CommissionSummary } from "@/lib/commission";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { DashboardSections } from "@/components/dashboard/dashboard-sections";
import { CommissionPanel } from "@/components/payments/commission-panel";

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/**
 * The account manager's day.
 *
 * Same piles as the admin dashboard and the same derivation behind them, cut
 * two ways: only their clients and the jobs they are on, and only today. An
 * account manager standing in a driveway at nine in the morning is not asking
 * how the month is going — they are asking what is left today, and a month
 * switcher on that screen is one more thing to tap past.
 *
 * Not tab-gated, for the same reason Today is not: it shows the signed-in
 * person their own work and nobody else's, so there is nothing here to
 * withhold, and putting it behind a tick is how somebody ends up with no
 * screen to open.
 */
export default async function MyDayPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const profile = await getCurrentProfile();
  if (!profile) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
        <h1 className="mb-1 text-2xl font-bold">My Day</h1>
        <p className="text-sm text-muted-foreground">Sign in to see your day.</p>
      </div>
    );
  }

  let data: DashboardData | null = null;
  try {
    data = await getDashboard("today", new Date(), { forProfileId: profile.id });
  } catch (err) {
    console.error("My Day failed to load:", err);
  }

  // Their own book, loaded separately so a money table that isn't set up costs
  // the commission panel rather than the whole day.
  const commission: CommissionSummary | null = await getCommissionFor(profile).catch((err) => {
    console.error("Commission failed to load:", err);
    return null;
  });

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
        <h1 className="mb-1 text-2xl font-bold">My Day</h1>
        <p className="rounded-xl border border-white/60 bg-card/60 p-4 text-sm text-muted-foreground backdrop-blur-md">
          Couldn&apos;t load your day right now. Reload the page and try again.
        </p>
      </div>
    );
  }

  const { summary } = data;
  const nothing =
    data.evaluations.every((s) => s.rows.length === 0) && data.jobs.every((s) => s.rows.length === 0);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <h1 className="text-2xl font-bold">My Day</h1>
      <p className="mb-4 text-muted-foreground">
        {profile.full_name || profile.email} — your clients and your jobs, today.
      </p>

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
          hint={summary.needsSignoff > 0 ? "Go and walk it" : undefined}
          alert={summary.needsSignoff > 0}
        />
        <Tile label="Booked value" value={money(summary.bookedValue)} hint="Your work today" />
      </div>

      {nothing ? (
        <p className="rounded-xl border border-white/60 bg-card/60 p-4 text-sm text-muted-foreground backdrop-blur-md">
          Nothing on your plate today. Anything overdue would show here, so a quiet screen means a quiet
          day — check the{" "}
          <Link href="/pipeline" className="underline">
            pipeline
          </Link>{" "}
          if you want something to push on.
        </p>
      ) : (
        <>
          <DashboardSections
            title="Evaluations"
            blurb="Visits on your clients. Anything still outstanding from before today is pulled in and marked late."
            sections={data.evaluations}
          />

          <DashboardSections
            title="Jobs"
            blurb="Your work. Sold-but-unbooked and sign-off piles ignore the date — they matter whenever they exist."
            sections={data.jobs}
          />
        </>
      )}

      {commission && commission.lines.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-1 text-lg font-bold">Your commission</h2>
          <CommissionPanel
            summary={commission}
            subtitle="Across every client you manage, not just today's."
          />
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Yours means the client is one you manage, or you are the person assigned to the job. Everything is
        read from the job itself, so it can never disagree with the job page.
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
