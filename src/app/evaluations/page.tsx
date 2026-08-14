import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile, listProfiles } from "@/lib/data/team";
import { requireTab } from "@/lib/data/access";
import { listJobsWithLocation } from "@/lib/data/jobs";
import { listDaysOff, listWeeklyOff } from "@/lib/data/availability";
import { EvaluationsView } from "@/components/evaluations/evaluations-view";

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function EvaluationsPage() {
  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-muted-foreground">Supabase is not configured yet.</p>
      </div>
    );
  }

  await requireTab("evaluations", "/attractors");

  const [profile, jobs] = await Promise.all([getCurrentProfile(), listJobsWithLocation()]);
  const isAdmin = profile?.roles.includes("admin") ?? false;

  // Admins see every evaluation across the team; everyone else sees only
  // what's assigned to them.
  const relevantJobs = (isAdmin ? jobs : jobs.filter((j) => j.assigned_to === profile?.id)).filter(
    (j) => j.evaluation_date
  );

  let evaluatorNamesById: Record<string, string> | undefined;
  if (isAdmin) {
    const profiles = await listProfiles();
    evaluatorNamesById = Object.fromEntries(profiles.map((p) => [p.id, p.full_name || p.email]));
  }

  const today = new Date();
  const rangeStartDate = new Date(today.getFullYear(), today.getMonth() - 2, 1);
  const rangeEndDate = new Date(today.getFullYear(), today.getMonth() + 6, 0);
  const rangeStart = dateKey(rangeStartDate);
  const rangeEnd = dateKey(rangeEndDate);

  const [allWeeklyOff, allDaysOff] = await Promise.all([listWeeklyOff(), listDaysOff(rangeStart, rangeEnd)]);

  const now = new Date().toISOString();
  const notCompleted = relevantJobs.filter((j) => j.evaluation_status !== "completed");

  const overdue = notCompleted
    .filter((j) => j.evaluation_date! < now)
    .sort((a, b) => a.evaluation_date!.localeCompare(b.evaluation_date!));

  const upcoming = notCompleted
    .filter((j) => j.evaluation_date! >= now)
    .sort((a, b) => a.evaluation_date!.localeCompare(b.evaluation_date!));

  const past = relevantJobs
    .filter((j) => j.evaluation_status === "completed")
    .sort((a, b) => b.evaluation_date!.localeCompare(a.evaluation_date!));

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">{isAdmin ? "All Evaluations" : "My Evaluations"}</h1>
      <p className="mb-6 text-muted-foreground">
        {isAdmin
          ? "Every evaluation across the team — who, where, when, and status."
          : "Evaluations assigned to you — where to go, when, and your progress on each one."}
      </p>
      {profile && (
        <EvaluationsView
          overdue={overdue}
          upcoming={upcoming}
          past={past}
          allRelevantJobs={relevantJobs}
          currentProfileId={profile.id}
          evaluatorNamesById={evaluatorNamesById}
          allWeeklyOff={allWeeklyOff}
          allDaysOff={allDaysOff}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
        />
      )}
    </div>
  );
}
