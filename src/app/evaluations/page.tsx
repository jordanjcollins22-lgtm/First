import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getMyScheduleData } from "@/lib/data/my-schedule";
import { MyEvaluationsContent } from "@/components/evaluations/my-evaluations-content";

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

  return <MyEvaluationsContent schedule={schedule} />;
}
