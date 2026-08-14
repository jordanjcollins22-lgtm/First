import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getMyScheduleData } from "@/lib/data/my-schedule";
import { EvaluationsView } from "@/components/evaluations/evaluations-view";

export default async function EvaluationsPage() {
  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-muted-foreground">Supabase is not configured yet.</p>
      </div>
    );
  }

  await requireTab("evaluations", "/attractors");

  const schedule = await getMyScheduleData();
  if (!schedule) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-muted-foreground">Sign in to see your evaluations.</p>
      </div>
    );
  }
  const { profile, isAdmin, relevantJobs, evaluatorNamesById, allWeeklyAvailability, allDaysOff, rangeStart, rangeEnd } =
    schedule;

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
      <EvaluationsView
        overdue={overdue}
        upcoming={upcoming}
        past={past}
        allRelevantJobs={relevantJobs}
        currentProfileId={profile.id}
        evaluatorNamesById={evaluatorNamesById}
        allWeeklyAvailability={allWeeklyAvailability}
        allDaysOff={allDaysOff}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
      />
    </div>
  );
}
