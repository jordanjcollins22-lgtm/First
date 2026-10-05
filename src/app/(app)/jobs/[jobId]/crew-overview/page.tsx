import { notFound, redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { requireJobAccess } from "@/lib/data/access";
import { createClient } from "@/lib/supabase/server";
import { getWorkOrderForJob } from "@/lib/data/work-order";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { getJobSchedule } from "@/lib/data/work-sessions";
import { getCurrentProfile } from "@/lib/data/team";
import { canRunJobs } from "@/lib/roles";
import { planCrewStages } from "@/lib/crew-overview";
import { zonesBounds } from "@/lib/work-order";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@/lib/canvas-dimensions";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { CrewOverview } from "@/components/job/crew-overview";
import type { WorkZone } from "@/components/canvas/types";

/**
 * The manager's crew sheet: the whole job on one page.
 *
 * The crew's own sheet (work-order) shows one area at a time, because that is
 * how a crew works through it. Whoever runs the job sees every area at once,
 * staged in the order the work should go, with where each one is up to. Same
 * loader as the crew's sheet, so the two never disagree about the work.
 *
 * For people who run jobs. Anybody else who opens it is sent to the crew's
 * sheet, which is the one meant for them.
 */
export default async function CrewOverviewPage({ params }: { params: Promise<{ jobId: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { jobId } = await params;
  await requireJobAccess(jobId, ["job-detail", "project-data", "evaluations", "pipeline"]);

  const viewer = await getCurrentProfile().catch(() => null);
  if (!viewer || !canRunJobs(viewer.roles)) redirect(`/jobs/${jobId}/work-order`);

  const supabase = await createClient();
  const [data, design, schedule, { data: jobRow }] = await Promise.all([
    getWorkOrderForJob(jobId),
    getCanvasDesignForJob(jobId),
    getJobSchedule(jobId).catch(() => ({ sessions: [], tickets: [], walkthroughs: [] })),
    supabase
      .from("jobs")
      .select("project_start_date, property:properties(customers(phone))")
      .eq("id", jobId)
      .maybeSingle(),
  ]);
  if (!data) notFound();

  const job = jobRow as unknown as {
    project_start_date: string | null;
    property: { customers: { phone: string | null } | null } | null;
  } | null;

  // The same areas the crew's sheet lists, in the same order, with the
  // answers that decide which stage each belongs in.
  const drawn = design ? ((design.zones ?? []) as unknown as WorkZone[]).filter((z) => z.service) : [];
  const byId = new Map(drawn.map((z) => [z.id, z]));
  const stages = planCrewStages(
    data.order.zones.map((z) => {
      const service = byId.get(z.id)?.service;
      return { typeId: service?.typeId ?? "", values: service?.values ?? {}, notes: z.notes, points: z.points };
    })
  );

  const sod = data.order.zones.reduce(
    (sum, z, i) =>
      stages.find((s) => s.key === "finish")?.zones.includes(i) ? sum + (byId.get(z.id)?.areaSqFt ?? 0) : sum,
    0
  );
  const firstVisit = schedule.sessions.find((s) => s.status !== "cancelled")?.starts_on ?? job?.project_start_date ?? null;

  return (
    <CrewOverview
      jobId={jobId}
      jobNumber={data.jobNumber}
      jobName={data.jobName}
      address={data.address}
      customerName={data.customerName}
      customerPhone={job?.property?.customers?.phone ?? null}
      jobStatus={data.jobStatus}
      startsOn={firstVisit}
      accountManager={data.accountManager}
      zones={data.order.zones}
      areaStates={data.areaBoard.states}
      afterZoneIds={data.photos.filter((p) => p.kind === "after" && p.zone_id).map((p) => p.zone_id!)}
      stages={stages}
      sodSqFt={Math.round(sod)}
      marks={data.marks}
      additions={data.approvedAdditions}
      siteImagePath={data.siteImagePath}
      imageTransform={data.imageTransform}
      frame={zonesBounds(data.order.zones, CANVAS_WIDTH, CANVAS_HEIGHT)}
    />
  );
}
