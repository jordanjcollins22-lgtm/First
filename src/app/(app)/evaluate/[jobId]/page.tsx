import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { requireJobAccess } from "@/lib/data/access";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { getIntakeForJob } from "@/lib/data/evaluation-intake";
import { lotForProperty } from "@/lib/data/lot-map";
import { isSeededZone, mergePlan, readPlan, seedPlan, visitStage } from "@/lib/evaluation-visit";
import type { EvaluationStatus } from "@/types/domain";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { VisitHeader } from "@/components/evaluations/visit-header";
import { SiteMapSetup } from "@/components/evaluations/site-map-setup";
import { YourPlan } from "@/components/intake/your-plan";

/**
 * One evaluation visit, on the evaluator's phone. On my way, I've arrived,
 * then what the client asked for, the site map set-up as Yes or No, and the
 * site map to measure and submit.
 */
export const dynamic = "force-dynamic";

export default async function EvaluationVisitPage({ params }: { params: Promise<{ jobId: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { jobId } = await params;
  await requireJobAccess(jobId, ["evaluations", "job-detail"]);

  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select(
      "id, property_id, status, evaluation_date, evaluation_status, evaluator_on_way_at, evaluator_arrived_at, evaluation_plan, property:properties(address, lat, lng, customer:customers(name, phone))"
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!data) notFound();
  const job = data as unknown as {
    id: string;
    property_id: string;
    status: string;
    evaluation_date: string | null;
    evaluation_status: EvaluationStatus;
    evaluator_on_way_at: string | null;
    evaluator_arrived_at: string | null;
    evaluation_plan: unknown;
    property: { address: string | null; lat: number | null; lng: number | null; customer: { name: string | null; phone: string | null } | null } | null;
  };

  const [viewer, organization, catalog, design, intake, lot] = await Promise.all([
    getCurrentProfile(),
    getCurrentOrganization().catch(() => null),
    getCanvasCatalog(),
    getCanvasDesignForJob(jobId),
    getIntakeForJob(jobId).catch(() => null),
    lotForProperty(job.property_id).catch(() => null),
  ]);
  const timeZone = organization?.reminder_time_zone || "America/New_York";
  const stage = visitStage(job);
  const onSite = stage === "arrived" || stage === "submitted";

  const active = catalog.servicePricing.filter((p) => p.status === "active");
  const findByName = (pattern: RegExp) => active.find((p) => pattern.test(p.name))?.service_type_id ?? null;
  const sent = intake?.submittedAt ? intake : null;
  const plan = mergePlan(readPlan(job.evaluation_plan), sent ? seedPlan(sent.answers, findByName) : []);
  const alreadyBuilt = ((design?.zones as unknown as { id: string }[] | undefined) ?? []).some((z) => isSeededZone(z.id));

  const client = job.property?.customer?.name || "Client";
  const phone = job.property?.customer?.phone ?? null;
  const when = job.evaluation_date
    ? new Date(job.evaluation_date).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone })
    : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
      <Link href="/evaluate" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ChevronLeft className="h-4 w-4" /> Your evaluations
      </Link>

      <VisitHeader
        jobId={jobId}
        when={when}
        client={client}
        address={job.property?.address ?? ""}
        phone={phone}
        stage={stage}
        arrivedAt={job.evaluator_arrived_at}
        timeZone={timeZone}
      />

      <details open={!onSite} className="rounded-2xl border border-border bg-card p-4">
        <summary className="cursor-pointer text-lg font-semibold">What they asked for</summary>
        <div className="mt-3">
          {sent ? (
            <YourPlan answers={sent.answers} photos={sent.photoUrls} lot={lot} />
          ) : (
            <p className="text-sm text-muted-foreground">
              They haven&apos;t sent the pre-evaluation form. Walk it with them and add what they want in the set-up.
            </p>
          )}
        </div>
      </details>

      {onSite ? (
        <SiteMapSetup
          jobId={jobId}
          initialPlan={plan}
          services={active.map((p) => ({ typeId: p.service_type_id, name: p.name }))}
          catalog={catalog}
          design={design}
          address={job.property?.address ?? ""}
          lat={job.property?.lat ?? null}
          lng={job.property?.lng ?? null}
          evaluationStatus={job.evaluation_status}
          evaluatorName={viewer?.full_name || viewer?.email || null}
          alreadyBuilt={alreadyBuilt}
        />
      ) : (
        <p className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          Tap I&apos;ve arrived when you get there to set up the site map.
        </p>
      )}
    </div>
  );
}
