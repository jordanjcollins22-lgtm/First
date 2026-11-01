import Link from "next/link";

import { requireTab } from "@/lib/data/access";
import { listCareerProgress } from "@/lib/data/career";
import { listProfiles } from "@/lib/data/team";
import { isSupabaseConfigured } from "@/lib/env";
import { STAGE_COUNT, summarize } from "@/lib/career/stages";
import { Progress } from "@/components/ui/progress";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { CareerMigrationNotice } from "@/components/career/migration-notice";

/**
 * Everybody on the team and where they are on the 21-stage career ladder.
 * Furthest along first, so the people closest to their next step are easy to
 * find; open somebody to see their stages and sign the next one off.
 */
export const dynamic = "force-dynamic";

export default async function CareerTrackerPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("career", "/my-day");

  const [profiles, { ready, byProfile }] = await Promise.all([listProfiles(), listCareerProgress()]);

  const rows = profiles
    .map((p) => ({ profile: p, summary: summarize(byProfile.get(p.id) ?? []) }))
    .sort(
      (a, b) =>
        b.summary.completed - a.summary.completed ||
        (a.profile.full_name ?? a.profile.email).localeCompare(b.profile.full_name ?? b.profile.email)
    );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <h1 className="mb-1 text-2xl font-bold">Career Tracker</h1>
      <p className="mb-6 text-muted-foreground">
        Each team member&apos;s place on the career ladder: Technician (Stages 1 to 7), General Manager (8 to
        14) and Owner (15 to 21). Every stage is earned on its metric, never on time served.
      </p>

      {!ready && <CareerMigrationNotice />}

      <ul className="space-y-2">
        {rows.map(({ profile, summary }) => (
          <li key={profile.id}>
            <Link
              href={`/admin/career/${profile.id}`}
              className="block rounded-lg border border-border bg-card/60 px-3 py-3 hover:border-primary"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{profile.full_name || profile.email}</span>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {summary.completed} of {STAGE_COUNT}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {summary.current
                  ? `${summary.tier.label} · Next: Stage ${summary.current.number}, ${summary.current.title}`
                  : "Every stage signed off"}
              </p>
              <Progress value={(summary.completed / STAGE_COUNT) * 100} className="mt-2 h-1.5" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
