import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getEvaluatorDay } from "@/lib/data/evaluator-day";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { EvaluatorDayView } from "@/components/evaluations/evaluator-day-view";

/**
 * The evaluator's own screen: today, what is coming, what is owed. Only
 * their own visits, or the whole team's for the owner who asks.
 */
export const dynamic = "force-dynamic";

export default async function EvaluatePage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("evaluations", "/my-day");
  const { all } = await searchParams;
  const data = await getEvaluatorDay({ everyone: all === "1" });
  if (!data) return <p className="p-6 text-muted-foreground">Sign in to see your evaluations.</p>;
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <EvaluatorDayView data={data} />
    </div>
  );
}
