import Link from "next/link";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { getProposalForJob } from "@/lib/data/proposals";
import { listJobMessages } from "@/lib/data/job-messages";
import { postJobMessage } from "@/lib/actions/job-message-actions";
import { ImageCanvasBoard } from "@/components/canvas/image-canvas-board";
import { ProposalPanel, type InternalZoneBreakdown } from "@/components/canvas/proposal-panel";
import { serviceTypeById } from "@/components/canvas/service-catalog";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { MessageThread } from "@/components/job/message-thread";
import { computeJobTotals, allMaterialLineItems, formatMaterialQuantity } from "@/lib/proposal-pricing";
import { isSupabaseConfigured } from "@/lib/env";
import type { WorkZone } from "@/components/canvas/types";
import type { EvaluationStatus } from "@/types/domain";

export default async function JobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

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
    evaluation_status: EvaluationStatus;
    client_notes: string | null;
    budget_range: string | null;
    property: { address: string; lat: number; lng: number } | null;
  };

  const [catalog, design, requestedServicesRes, proposal, headersList, internalMessages, externalMessages] =
    await Promise.all([
      getCanvasCatalog(),
      getCanvasDesignForJob(jobId),
      supabase.from("job_requested_services").select("service_type_id").eq("job_id", jobId),
      getProposalForJob(jobId),
      headers(),
      listJobMessages(jobId, "internal"),
      listJobMessages(jobId, "external"),
    ]);
  const requestedServiceIds = (requestedServicesRes.data ?? []).map((r) => r.service_type_id);
  const requestedServiceNames = requestedServiceIds.map(
    (id) => catalog.servicePricing.find((s) => s.service_type_id === id)?.name ?? id
  );
  const hasClientRequest = requestedServiceNames.length > 0 || job.client_notes || job.budget_range;

  const zones = design ? ((design.zones as unknown as WorkZone[]).filter((z) => z.service)) : [];
  const { totalCost: serviceCost } = computeJobTotals(zones, catalog);
  const materialItems = allMaterialLineItems(zones, catalog);
  const materialsCost = materialItems.reduce((sum, item) => sum + (item.totalCost ?? 0), 0);
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
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">
      <Link href="/attractors" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        Back to Project Data
      </Link>

      <div>
        <h1 className="text-2xl font-bold">{job.property?.address ?? job.name}</h1>
        <p className="text-muted-foreground">
          Draw work zones and fill in the service details to build a scope of work for this job.
        </p>
      </div>

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
      />

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
