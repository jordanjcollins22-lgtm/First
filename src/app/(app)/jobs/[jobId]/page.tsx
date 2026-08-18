import Link from "next/link";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { getProposalForJob } from "@/lib/data/proposals";
import { getInvoiceForJob } from "@/lib/data/invoices";
import { listDiscounts } from "@/lib/data/discounts";
import { listJobMessages } from "@/lib/data/job-messages";
import { listJobPhotos } from "@/lib/data/job-photos";
import { getJobSchedule } from "@/lib/data/work-sessions";
import { postJobMessage } from "@/lib/actions/job-message-actions";
import { ImageCanvasBoard } from "@/components/canvas/image-canvas-board";
import { ProposalPanel, type InternalZoneBreakdown } from "@/components/canvas/proposal-panel";
import { serviceTypeById } from "@/components/canvas/service-catalog";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { MessageThread } from "@/components/job/message-thread";
import { CallClientButton } from "@/components/job/call-client-button";
import { InvoicePanel } from "@/components/job/invoice-panel";
import { SchedulePanel } from "@/components/job/schedule-panel";
import { CompletionPanel } from "@/components/job/completion-panel";
import { VisitsPanel } from "@/components/job/visits-panel";
import { computeJobTotals, allMaterialLineItems, formatMaterialQuantity } from "@/lib/proposal-pricing";
import { isSupabaseConfigured, isTwilioConfigured } from "@/lib/env";
import type { WorkZone } from "@/components/canvas/types";
import type { EvaluationStatus, JobStatus } from "@/types/domain";
import { requireTab } from "@/lib/data/access";

export default async function JobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("job-detail", "/attractors");

  const { jobId } = await params;
  const supabase = await createClient();

  const { data: jobRow, error: jobError } = await supabase
    .from("jobs")
    .select("*, property:properties(address, lat, lng)")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) throw jobError;
  if (!jobRow) notFound();

  const job = jobRow as unknown as {
    id: string;
    name: string;
    status: JobStatus;
    evaluation_status: EvaluationStatus;
    evaluation_date: string | null;
    evaluation_end_date: string | null;
    project_start_date: string | null;
    project_end_date: string | null;
    cancellation_reason: string | null;
    completed_at: string | null;
    completed_by: string | null;
    completion_notes: string | null;
    client_notes: string | null;
    budget_range: string | null;
    property: { address: string; lat: number; lng: number } | null;
  };

  const [
    catalog,
    design,
    requestedServicesRes,
    proposal,
    invoice,
    headersList,
    internalMessages,
    externalMessages,
    discounts,
    photos,
    schedule,
  ] = await Promise.all([
    getCanvasCatalog(),
    getCanvasDesignForJob(jobId),
    supabase.from("job_requested_services").select("service_type_id").eq("job_id", jobId),
    getProposalForJob(jobId),
    // Falls back to null if migration 0060 (the invoices table) hasn't been
    // run yet — the rest of the job page shouldn't 500 for a missing panel.
    getInvoiceForJob(jobId).catch(() => null),
    headers(),
    listJobMessages(jobId, "internal"),
    listJobMessages(jobId, "external"),
    listDiscounts(),
    // Empty until migration 0078 runs, so the rest of the page still loads.
    listJobPhotos(jobId).catch(() => []),
    // Empty until migration 0080 runs, so the page still loads without it.
    getJobSchedule(jobId).catch(() => ({ sessions: [], tickets: [] })),
  ]);

  // Only worth a lookup once somebody has actually signed the job off.
  let completedByName: string | null = null;
  if (job.completed_by) {
    const { data: signer } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", job.completed_by)
      .maybeSingle();
    completedByName = signer?.full_name || signer?.email || null;
  }
  const requestedServiceIds = (requestedServicesRes.data ?? []).map((r) => r.service_type_id);
  const requestedServiceNames = requestedServiceIds.map(
    (id) => catalog.servicePricing.find((s) => s.service_type_id === id)?.name ?? id
  );
  const hasClientRequest = requestedServiceNames.length > 0 || job.client_notes || job.budget_range;

  const zones = design ? ((design.zones as unknown as WorkZone[]).filter((z) => z.service)) : [];
  const { totalCost: serviceCost } = computeJobTotals(zones, catalog);
  const materialItems = allMaterialLineItems(zones, catalog);
  const materialsCost = materialItems.reduce((sum, item) => sum + (item.totalCost ?? 0), 0);
  // Documentation follows the priced zones — the work that was actually sold.
  // A drawn shape with no service on it is a draft, and requiring photos of a
  // draft would block sign-off on scratch work.
  const photoZones = zones.map((zone) => ({ id: zone.id, name: zone.name }));

  const zoneBreakdowns: InternalZoneBreakdown[] = zones.map((zone) => {
    const def = zone.service ? serviceTypeById(zone.service.typeId) : undefined;
    const checklistAnswers = (def?.fields ?? [])
      .filter((field) => zone.service?.values[field.key])
      .map((field) => ({ label: field.label, value: zone.service!.values[field.key] }));
    return {
      zoneName: zone.name,
      serviceLabel: def?.label ?? zone.service?.typeId ?? "Service",
      notes: zone.service?.notes ?? "",
      checklistAnswers,
      materialLineItems: materialItems
        .filter((item) => item.zoneName === zone.name)
        .map((item) => ({ material: item.material, quantityLabel: formatMaterialQuantity(item), cost: item.totalCost })),
    };
  });

  const host = headersList.get("host") ?? "";
  const proto = headersList.get("x-forwarded-proto") ?? "https";
  const baseUrl = host ? `${proto}://${host}` : "";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 sm:gap-6 sm:py-10">
      <Link href="/attractors" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        Back to Project Data
      </Link>

      <div>
        <h1 className="text-xl font-bold sm:text-2xl">{job.property?.address ?? job.name}</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          Draw work zones and fill in the service details to build a scope of work for this job.
        </p>
      </div>

      <CompletionPanel
        jobId={jobId}
        status={job.status}
        photos={photos}
        zones={photoZones}
        completedAt={job.completed_at}
        completedByName={completedByName}
        completionNotes={job.completion_notes}
      />

      <VisitsPanel jobId={jobId} sessions={schedule.sessions} tickets={schedule.tickets} />

      <SchedulePanel
        jobId={jobId}
        status={job.status}
        evaluationStatus={job.evaluation_status}
        evaluationDate={job.evaluation_date}
        evaluationEndDate={job.evaluation_end_date}
        projectStartDate={job.project_start_date}
        projectEndDate={job.project_end_date}
        cancellationReason={job.cancellation_reason}
      />

      {hasClientRequest && (
        <div className="rounded-lg border border-white/60 bg-card/60 px-4 py-3 text-sm backdrop-blur-md">
          <p className="mb-1.5 font-semibold">What the client asked for</p>
          {requestedServiceNames.length > 0 && (
            <p>
              <span className="text-muted-foreground">Services: </span>
              {requestedServiceNames.join(", ")}
            </p>
          )}
          {job.budget_range && (
            <p>
              <span className="text-muted-foreground">Budget: </span>
              {job.budget_range}
            </p>
          )}
          {job.client_notes && (
            <p>
              <span className="text-muted-foreground">Notes: </span>
              {job.client_notes}
            </p>
          )}
        </div>
      )}

      <ProposalPanel
        jobId={jobId}
        proposal={proposal}
        baseUrl={baseUrl}
        serviceCost={serviceCost}
        materialsCost={materialsCost}
        zones={zoneBreakdowns}
        discounts={discounts}
      />

      <InvoicePanel invoice={invoice} />

      {isTwilioConfigured && <CallClientButton jobId={jobId} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MessageThread
          title="Internal Notes"
          messages={internalMessages}
          onSend={postJobMessage.bind(null, jobId, "internal")}
          viewerAuthorType="team"
          placeholder="Note for the team..."
          emptyLabel="No internal notes yet."
        />
        <MessageThread
          title="Client Conversation"
          messages={externalMessages}
          onSend={postJobMessage.bind(null, jobId, "external")}
          viewerAuthorType="team"
          placeholder="Message the client..."
          emptyLabel="No messages with the client yet."
          footnote={isTwilioConfigured ? "Also sent as a text message." : "Add Twilio to also send this as a text."}
        />
      </div>

      <ImageCanvasBoard
        catalog={catalog}
        jobId={jobId}
        initialDesign={design}
        initialAddress={job.property?.address ?? ""}
        initialLat={job.property?.lat}
        initialLng={job.property?.lng}
        initialEvaluationStatus={job.evaluation_status}
      />
    </div>
  );
}
