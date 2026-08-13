import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { requireTab } from "@/lib/data/access";
import { listJobsWithLocation } from "@/lib/data/jobs";
import { EvaluationList } from "@/components/evaluations/evaluation-list";

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
  const myJobs = jobs.filter((j) => j.assigned_to === profile?.id && j.evaluation_date);

  const upcoming = myJobs
    .filter((j) => j.evaluation_status !== "completed")
    .sort((a, b) => a.evaluation_date!.localeCompare(b.evaluation_date!));

  const past = myJobs
    .filter((j) => j.evaluation_status === "completed")
    .sort((a, b) => b.evaluation_date!.localeCompare(a.evaluation_date!));

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">My Evaluations</h1>
      <p className="mb-6 text-muted-foreground">
        Evaluations assigned to you — where to go, when, and your progress on each one.
      </p>
      <EvaluationList upcoming={upcoming} past={past} />
    </div>
  );
}
