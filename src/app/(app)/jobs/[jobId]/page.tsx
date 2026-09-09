import Link from "next/link";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { listEvaluationEdits } from "@/lib/data/evaluation-edits";
import { EvaluationChangesPanel } from "@/components/job/evaluation-changes-panel";
import type { EditableZone } from "@/lib/evaluation-edit";
import { getProposalForJob } from "@/lib/data/proposals";
import { viewsForJob } from "@/lib/data/proposal-views";
import { settleProposalForJob } from "@/lib/actions/proposal-settlement";
import { JobSummary } from "@/components/job/job-summary";
import { outstandingFor, sectionToOpen } from "@/lib/job-outstanding";
import { jobFacts, listGateOverrides, listJobIssues } from "@/lib/data/issues";
import { evaluateGate } from "@/lib/readiness";
import { canOverrideGate } from "@/lib/affiliate-roles";
import { visibilityFor } from "@/lib/roles";
import { JobTabbedSections } from "@/components/job/job-tabbed-sections";
import { FieldScreen } from "@/components/job/field-screen";
import { IssuesPanel } from "@/components/issues/issues-panel";
import { ExceptionsPanel } from "@/components/exceptions/exceptions-panel";
import { ScopeChangesPanel } from "@/components/exceptions/scope-changes-panel";
import { JobHistory } from "@/components/exceptions/job-history";
import {
  executableAdditions,
  jobProgress,
  listAuditEvents,
  listCrewAssignments,
  listJobExceptions,
  listScopeChanges,
} from "@/lib/data/exceptions";
import { canDecideException, canReviewScopeChange, EXCEPTION_KINDS } from "@/lib/exceptions";
import { roleKeysOf } from "@/lib/roles";
import { ReadinessPanel } from "@/components/readiness/readiness-panel";
import { ConfirmationsPanel } from "@/components/readiness/confirmations-panel";
import { activityLabel, isWarm } from "@/lib/proposal-views";
import { getInvoiceForJob } from "@/lib/data/invoices";
import { listDiscounts } from "@/lib/data/discounts";
import { listJobMessages } from "@/lib/data/job-messages";
import { listJobPhotos } from "@/lib/data/job-photos";
import { listSocialPostsForJob } from "@/lib/data/social";
import { listPhotoWaivers } from "@/lib/data/photo-waivers";
import { listPhotoMarks } from "@/lib/data/photo-review";
import { listJobEntries, listPayPeople } from "@/lib/data/time-clock";
import { listPlansForJob } from "@/lib/data/payment-plans";
import { PaymentPlanPanel } from "@/components/payments/payment-plan-panel";
import { isStripeConfigured } from "@/lib/env";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { PhotoReviewPanel } from "@/components/job/photo-review-panel";
import { isAccountManager as isManagerRole } from "@/lib/affiliate-roles";
import { beforesFromZones, notYetAdopted, type ZoneLike } from "@/lib/evaluation-befores";
import { getJobSchedule } from "@/lib/data/work-sessions";
import { capabilities, deriveStage } from "@/lib/job-stage";
import { isMissingTable } from "@/lib/setup-errors";
import { postJobMessage } from "@/lib/actions/job-message-actions";
import { ImageCanvasBoard } from "@/components/canvas/image-canvas-board";
import { ProposalPanel, type InternalZoneBreakdown } from "@/components/canvas/proposal-panel";
import { serviceTypeById } from "@/components/canvas/service-catalog";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { MessageThread } from "@/components/job/message-thread";
import { CallClientButton } from "@/components/job/call-client-button";
import { InvoiceSection } from "@/components/job/invoice-section";
import { responseLabel } from "@/lib/proposal-accepted";
import { SchedulePanel } from "@/components/job/schedule-panel";
import { CompletionPanel } from "@/components/job/completion-panel";
import { BeforeAfterPanel } from "@/components/marketing/before-after-panel";
import { VisitsPanel } from "@/components/job/visits-panel";
import { WalkthroughPanel } from "@/components/job/walkthrough-panel";
import { CrewPanel } from "@/components/job/crew-panel";
import { ObserversPanel, type ObserverRow } from "@/components/job/observers-panel";
import { WorkOrderView } from "@/components/job/work-order-view";
import { getWorkOrderForJob } from "@/lib/data/work-order";
import { formatJobNumber } from "@/lib/job-number";
import { isFieldOnly } from "@/lib/affiliate-roles";
import { costJob, costZone, zoneCrewHours, allMaterialLineItems, formatMaterialQuantity } from "@/lib/proposal-pricing";
import { env, isSupabaseConfigured, isTwilioConfigured } from "@/lib/env";
import { resolveBaseUrl } from "@/lib/app-url";
import type { WorkZone } from "@/components/canvas/types";
import type { EvaluationStatus, JobCrewMember, JobStatus, Profile } from "@/types/domain";
import { getJobCommission } from "@/lib/data/commission";
import { JobCommissionPanel } from "@/components/payments/job-commission";
import { requireJobAccess } from "@/lib/data/access";
import { getCurrentProfile, listProfiles } from "@/lib/data/team";
import { isAccountManager } from "@/lib/affiliate-roles";
import { serviceLabelFor } from "@/lib/zone-scope";

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams?: Promise<{ view?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { jobId } = await params;
  const { view } = (await searchParams) ?? {};

  // Reachable from Project Data, the calendar and the pipeline — anyone who
  // can see the job in one of those can open it. Assignment counts too: a
  // crew member's Today screen links straight here, and being unable to open
  // the job you are standing on would make that link a dead end.
  await requireJobAccess(jobId, ["job-detail", "project-data", "evaluations", "pipeline"]);

  const supabase = await createClient();

  const { data: jobRow, error: jobError } = await supabase
    .from("jobs")
    .select("*, property:properties(address, lat, lng, customers(id, name, phone))")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) throw jobError;
  if (!jobRow) notFound();

  const job = jobRow as unknown as {
    id: string;
    job_number: number | null;
    name: string;
    status: JobStatus;
    evaluation_status: EvaluationStatus;
    evaluation_date: string | null;
    evaluation_end_date: string | null;
    project_start_date: string | null;
    project_end_date: string | null;
    cancellation_reason: string | null;
    property_id: string;
    completed_at: string | null;
    completed_by: string | null;
    completion_notes: string | null;
    photos_approved_at: string | null;
    photos_approved_by: string | null;
    client_notes: string | null;
    budget_range: string | null;
    property: {
      address: string;
      lat: number;
      lng: number;
      customers: { id: string; name: string; phone: string | null } | null;
    } | null;
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
    socialPosts,
    photoWaivers,
    photoMarks,
    jobTimeEntries,
    payPeople,
    paymentPlans,
    schedule,
    crew,
    teamProfiles,
    observerRows,
    ownerRow,
    viewer,
    proposalViews,
    organization,
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
    listSocialPostsForJob(jobId).catch(() => []),
    // Empty until migration 0112 runs; the panel just asks for every stage.
    listPhotoWaivers(jobId).catch(() => []),
    // Empty until migration 0114 runs; the panel simply does not appear.
    listPhotoMarks(jobId).catch(() => []),
    // Empty until migration 0113/0115 run; the visit just shows nobody logged.
    listJobEntries(jobId).catch(() => []),
    listPayPeople().catch(() => []),
    // Empty until migration 0116 runs; the panel just offers to start one.
    listPlansForJob(jobId).catch(() => []),
    // Empty until migration 0080 runs, so the page still loads without it.
    getJobSchedule(jobId).catch(() => ({ sessions: [], tickets: [], walkthroughs: [] })),
    // Empty until migration 0083 runs; the page still loads without it.
    // Distinguishes "no crew yet" from "the table doesn't exist", so the panel
    // can tell somebody to run the migration instead of looking merely empty.
    supabase
      .from("job_crew")
      .select("*")
      .eq("job_id", jobId)
      .then(({ data, error }) => ({
        rows: (data ?? []) as unknown as JobCrewMember[],
        missing: isMissingTable(error),
      })),
    listProfiles().catch(() => []),
    // Empty until migration 0086 runs; the panel says so rather than looking
    // merely empty.
    supabase
      .from("job_observers")
      .select("id, name, email, phone, relationship, token, revoked_at, last_viewed_at")
      .eq("job_id", jobId)
      .order("created_at")
      .then(({ data, error }) => ({
        rows: (data ?? []) as unknown as {
          id: string;
          name: string;
          email: string | null;
          phone: string | null;
          relationship: string;
          token: string;
          revoked_at: string | null;
          last_viewed_at: string | null;
        }[],
        missing: isMissingTable(error),
      })),
    // The three below used to run one after another once the batch was done,
    // which cost three round trips nobody was waiting on. None of them
    // depends on anything in the batch, so they belong in it.
    supabase
      .from("properties")
      .select("customer_id, customers(account_manager_id)")
      .eq("id", job.property_id)
      .maybeSingle()
      .then(({ data }) => data),
    getCurrentProfile(),
    // Reached through the job rather than the proposal, so it does not have
    // to wait for the proposal to come back first.
    viewsForJob(jobId).catch(() => null),
    // Cached per request, so this costs nothing the layout has not already
    // paid. Wanted for the clock the office keeps: a timestamp rendered in
    // the server's UTC dates an evening signature to the following morning.
    getCurrentOrganization(),
  ]);

  // Names for whoever asked for or decided a walkthrough, plus the sign-off.
  const walkPeople = Array.from(
    new Set(
      schedule.walkthroughs.flatMap((w) => [w.requested_by, w.reviewed_by]).filter(Boolean) as string[]
    )
  );
  let namesById: Record<string, string> = {};
  if (walkPeople.length > 0) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", walkPeople);
    namesById = Object.fromEntries(
      ((people ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [
        p.id,
        p.full_name || p.email,
      ])
    );
  }

  // The manager who rules on the walk is the customer's account manager;
  // admins can always decide, so a job never stalls because one person is out.
  const owner = ownerRow as unknown as {
    customer_id: string;
    customers: { account_manager_id: string | null } | null;
  } | null;
  const customerId = owner?.customer_id ?? "";
  const accountManagerId = owner?.customers?.account_manager_id ?? null;

  // The same wording as the pipeline card and the proposals list.
  const proposalViewHint = proposalViews ? activityLabel(proposalViews, new Date()) : null;

  // When they answered, in the office's own clock. Worded once, so the
  // proposal panel and the invoice cannot date the same signature differently.
  const respondedLabel = responseLabel(
    proposal?.status ?? null,
    proposal?.responded_at ?? null,
    organization.reminder_time_zone
  );

  // Covers the client who paid and closed the tab on Stripe's receipt without
  // ever landing back on our page. Their money is in and nothing here knew
  // it, which is the case a webhook is usually bought for.
  await settleProposalForJob(jobId).catch(() => {});

  const canReviewWalk = Boolean(
    viewer &&
      (viewer.roles.includes("admin") ||
        isAccountManager(viewer.roles) ||
        viewer.id === accountManagerId)
  );

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
  // What the job costs us and what it prices at, from the same function the
  // proposal is built with, so the internal breakdown and the client's number
  // can never be two different opinions.
  const jobCost = costJob(zones, catalog);
  const labourCost = jobCost.labourCents / 100;
  const materialItems = allMaterialLineItems(zones, catalog);
  const materialsCost = jobCost.materialsCents / 100;
  // Documentation follows the priced zones — the work that was actually sold.
  // A drawn shape with no service on it is a draft, and requiring photos of a
  // draft would block sign-off on scratch work.
  const photoZones = zones.map((zone) => ({ id: zone.id, name: zone.name }));

  // Zone photos from the evaluation that are not already befores. Somebody
  // photographed this garden before anything was touched, so asking for a
  // before while those sit unused is asking twice.
  // Managers mark and approve; anybody else on the job sees the list and
  // can clear it. Admins can do both, because somebody has to be able to.
  const canReviewPhotos = Boolean(
    viewer && (viewer.roles.includes("admin") || isManagerRole(viewer.roles))
  );
  const photosApprovedByName = job.photos_approved_by
    ? teamProfiles.find((p) => p.id === job.photos_approved_by)?.full_name ?? null
    : null;

  const evaluationBeforesAvailable = notYetAdopted(
    beforesFromZones(jobId, zones as unknown as ZoneLike[]),
    photos.map((photo) => photo.path)
  ).length;

  const pricingByType = new Map(catalog.servicePricing.map((p) => [p.service_type_id, p]));

  // Every zone, not only the priced ones: a shape drawn with no service on it
  // is still something somebody may need to correct or take off.
  const allZones = design ? ((design.zones ?? []) as unknown as WorkZone[]) : [];
  const evaluationEdits = await listEvaluationEdits(jobId);
  const serviceOptions = catalog.servicePricing.map((p) => ({
    id: p.service_type_id,
    name: p.name,
  }));

  const zoneBreakdowns: InternalZoneBreakdown[] = zones.map((zone) => {
    const def = zone.service ? serviceTypeById(zone.service.typeId) : undefined;
    // A service this business added itself has no built-in definition; its
    // name is on the pricing row. Without this the crew sheet showed a uuid.
    const pricingRow = zone.service ? pricingByType.get(zone.service.typeId) : undefined;
    const checklistAnswers = (def?.fields ?? [])
      .filter((field) => zone.service?.values[field.key])
      .map((field) => ({ label: field.label, value: zone.service!.values[field.key] }));
    const cost = costZone(zone, catalog);
    return {
      zoneName: zone.name,
      serviceLabel: serviceLabelFor(def, pricingRow ? { name: pricingRow.name } : undefined),
      notes: zone.service?.notes ?? "",
      checklistAnswers,
      crewHours: zoneCrewHours(zone, catalog).hours,
      materialsCents: cost.materialsCents,
      labourCents: cost.labourCents,
      directCostCents: cost.directCostCents,
      priceCents: cost.priceCents,
      hasMissingTiming: cost.hasMissingTiming,
      hasUnknownMaterialCost: cost.hasUnknownMaterialCost,
      materialLineItems: materialItems
        .filter((item) => item.zoneName === zone.name)
        .map((item) => ({ material: item.material, quantityLabel: formatMaterialQuantity(item), cost: item.totalCost })),
    };
  });

  // What this job can actually do right now. Everything below renders against
  // this rather than showing every panel and hoping people know the order.
  const stageInput = {
    status: job.status,
    evaluationStatus: job.evaluation_status,
    evaluationDate: job.evaluation_date,
    proposalStatus: proposal?.status ?? null,
    sessions: schedule.sessions.map((s) => ({ status: s.status })),
    walkthroughs: schedule.walkthroughs,
  };
  const stage = deriveStage(stageInput);
  const can = capabilities(stageInput);

  const liveSessions = schedule.sessions.filter((s) => s.status !== "cancelled").length;

  // A job already carrying dates or visits must always be fixable, whatever
  // stage it is at. Gating that behind an accepted proposal strands anything
  // scheduled by mistake, imported wrong, or booked before the paperwork.
  const alreadyScheduled = liveSessions > 0 || Boolean(job.project_start_date || job.project_end_date);
  // What the job still owes, worked out from what already exists. The page
  // leads with this: somebody opening a job on a phone is nearly always
  // answering one question, and it should not take a scroll.
  const photosByZone: Record<string, string[]> = {};
  for (const photo of photos) {
    const zone = photo.zone_name;
    if (!zone) continue;
    photosByZone[zone] = [...(photosByZone[zone] ?? []), photo.kind];
  }

  // The client's number, read off the customer record rather than copied onto
  // the job: one phone number, in the place a phone number belongs.
  const clientPhone = job.property?.customers?.phone ?? null;

  // What this person is given, decided once. A project lead runs the job and
  // needs every measurement on it; what the client is paying is not theirs,
  // and the honest way to withhold it is not to put it in the answer. A
  // hidden panel is not a permission -- anybody can open the network tab.
  const seen = visibilityFor(viewer?.roles ?? []);

  const outstanding = outstandingFor({
    stage,
    evaluationBooked: Boolean(job.evaluation_date),
    evaluationDone: job.evaluation_status === "completed",
    zonesMeasured: photoZones.length,
    proposalStatus: proposal?.status ?? null,
    scheduled: Boolean(job.project_start_date || job.project_end_date),
    visitsBooked: schedule.sessions.length,
    zoneNames: photoZones.map((z) => z.name),
    photosByZone,
    walkthroughRequested: schedule.walkthroughs.some((w) => w.status === "requested"),
    walkthroughApproved: schedule.walkthroughs.some((w) => w.status === "approved"),
    signedOff: job.status === "completed",
    invoiced: Boolean(invoice),
  });

  const canManageVisits = can.visits.available || alreadyScheduled;

  // Field-only people get the work order, not the office's view of the job.
  // Proposal totals, discounts and invoices are none of a crew member's
  // business to be reading on a customer's driveway — and until now this page
  // showed them all of it.
  const viewerRoles = (await getCurrentProfile())?.roles ?? [];
  if (isFieldOnly(viewerRoles)) {
    // The same loader the sheet's own URL uses, so what the crew see here and
    // what anybody else sees there can never be two different things.
    const sheet = await getWorkOrderForJob(jobId);
    if (!sheet) notFound();
    return <WorkOrderView jobId={jobId} {...sheet} />;
  }

  const host = headersList.get("host") ?? "";
  const baseUrl = resolveBaseUrl({
    configured: env.appUrl,
    productionDomain: env.productionDomain,
    host,
    proto: headersList.get("x-forwarded-proto"),
  });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 sm:gap-6 sm:py-10">
      <Link href="/attractors" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        Back to Project Data
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold sm:text-2xl">{job.property?.address ?? job.name}</h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            {job.name}
            {formatJobNumber(job.job_number) && (
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-xs tabular-nums">
                {formatJobNumber(job.job_number)}
              </span>
            )}
          </p>
        </div>
        {/* What the crew will actually be looking at on site. Worth a tap from
            here rather than only from inside the drawing tool — checking the
            sheet before sending somebody out is the point of it existing. */}
        <Link
          href={`/jobs/${jobId}/work-order`}
          className="shrink-0 rounded-lg border border-white/60 bg-card/60 px-3 py-2 text-sm font-medium backdrop-blur-md hover:bg-accent/50"
        >
          View crew sheet
        </Link>
      </div>

      <JobSummary items={outstanding} />

      <JobTabbedSections
        initialTab={view}
        defaultOpen={sectionToOpen(outstanding)}
        overview={await OverviewTab(jobId, viewer?.roles ?? [], viewer)}
        field={await FieldTab(jobId, job.property?.address ?? null, clientPhone, viewer?.roles ?? [])}
        issues={await IssuesTab(jobId, viewer?.roles ?? [])}
        closeout={await CloseoutTab(jobId, viewer?.roles ?? [])}
        sections={[
          {
            id: "map",
            title: "Site map and measurements",
            hint: `${photoZones.length} zone${photoZones.length === 1 ? "" : "s"} drawn`,
            body: (
              <div className="flex flex-col gap-4">
                <ImageCanvasBoard
                  catalog={catalog}
                  jobId={jobId}
                  initialDesign={design}
                  initialAddress={job.property?.address ?? ""}
                  initialLat={job.property?.lat}
                  initialLng={job.property?.lng}
                  initialEvaluationStatus={job.evaluation_status}
                  evaluatorName={viewer?.full_name || viewer?.email || null}
                />

                {/* For what comes in afterwards. A client texting a new
                    measurement should not mean redrawing the map on a phone. */}
                <EvaluationChangesPanel
                  jobId={jobId}
                  zones={allZones as unknown as EditableZone[]}
                  services={serviceOptions}
                  history={evaluationEdits}
                />
              </div>
            ),
          },
          ...(!seen.jobMoney ? [] : [{
            id: "proposal",
            title: "Proposal",
            hint: proposal ? (proposalViewHint ?? proposal.status) : "Not built yet",
            lockedReason:
              can.proposal.available || proposal ? null : can.proposal.reason,
            body: (
              <ProposalPanel
                jobId={jobId}
                proposal={proposal}
                baseUrl={baseUrl}
                labourCost={labourCost}
                markup={catalog.markup}
                materialsCost={materialsCost}
                zones={zoneBreakdowns}
                discounts={discounts}
                viewLabel={proposalViewHint}
                viewsWarm={
                  proposalViews ? isWarm(proposalViews, proposal?.status ?? "") : false
                }
                respondedLabel={respondedLabel}
              />
            ),
          }]),
          {
            id: "schedule",
            title: "Schedule",
            hint: job.project_start_date ?? job.evaluation_date ?? "Nothing booked",
            body: (
              <SchedulePanel
                jobId={jobId}
                status={job.status}
                evaluationStatus={job.evaluation_status}
                evaluationDate={job.evaluation_date}
                evaluationEndDate={job.evaluation_end_date}
                projectStartDate={job.project_start_date}
                projectEndDate={job.project_end_date}
                sessionCount={liveSessions}
                cancellationReason={job.cancellation_reason}
              />
            ),
          },
          {
            id: "photos",
            title: "Photos and sign-off",
            hint: `${photos.length} photo${photos.length === 1 ? "" : "s"} submitted`,
            lockedReason:
              can.photoBefore.available || photos.length > 0 ? null : can.photoBefore.reason,
            body: (
              <CompletionPanel
                jobId={jobId}
                evaluationBeforesAvailable={evaluationBeforesAvailable}
                waivers={photoWaivers}
                lockedStageReason={can.photoDuring.available ? null : can.photoDuring.reason}
                status={job.status}
                photos={photos}
                zones={photoZones}
                allowDuring={can.photoDuring.available}
                allowAfter={can.photoAfter.available}
                allowSignOff={can.signOff.available}
                signOffLockReason={can.signOff.available ? null : can.signOff.reason}
                completedAt={job.completed_at}
                completedByName={completedByName}
                completionNotes={job.completion_notes}
              />
            ),
          },
          {
            id: "walkthrough",
            title: "Manager walkthrough",
            hint: schedule.walkthroughs.length > 0 ? null : "Not requested",
            lockedReason:
              can.requestWalkthrough.available || schedule.walkthroughs.length > 0
                ? null
                : "Not until there is finished work to walk.",
            body: (
              <WalkthroughPanel
                jobId={jobId}
                walkthroughs={schedule.walkthroughs}
                canRequest={can.requestWalkthrough.available}
                requestLockReason={
                  can.requestWalkthrough.available ? null : can.requestWalkthrough.reason
                }
                canReview={canReviewWalk}
                namesById={namesById}
              />
            ),
          },
          {
            id: "review",
            title: "Photo review",
            hint: job.photos_approved_at ? "Approved" : "Not reviewed",
            body: (
              <PhotoReviewPanel
                jobId={jobId}
                photos={photos.filter((photo) => photo.kind === "after")}
                marks={photoMarks}
                crewSignedOff={job.status === "completed"}
                approvedAt={job.photos_approved_at ?? null}
                approvedByName={photosApprovedByName}
                canReview={canReviewPhotos}
              />
            ),
          },
          {
            id: "visits",
            title: "Visits and tickets",
            hint: `${schedule.sessions.length} visit${schedule.sessions.length === 1 ? "" : "s"}`,
            lockedReason:
              canManageVisits || schedule.tickets.length > 0
                ? null
                : can.visits.available
                  ? ""
                  : can.visits.reason,
            body: (
              <VisitsPanel
                jobId={jobId}
                sessions={schedule.sessions}
                timeEntries={jobTimeEntries}
                people={payPeople}
                canLogWork={Boolean(viewer?.roles.includes("admin"))}
                canSeePay={Boolean(viewer?.roles.includes("admin"))}
                tickets={schedule.tickets}
                allowTickets={can.tickets.available}
              />
            ),
          },
          {
            id: "crew",
            title: "Crew and who can watch",
            hint: `${crew.rows.length} on the job`,
            body: (
              <div className="flex flex-col gap-4">
                <CrewPanel
                  jobId={jobId}
                  status={job.status}
                  crew={crew.rows}
                  setupNeeded={crew.missing}
                  customerId={customerId}
                  accountManagerId={accountManagerId}
                  profiles={teamProfiles}
                  editable={job.status !== "completed" && job.status !== "cancelled"}
                />
                <ObserversPanel
                  jobId={jobId}
                  baseUrl={baseUrl}
                  setupNeeded={observerRows.missing}
                  observers={observerRows.rows.map(
                    (o): ObserverRow => ({
                      id: o.id,
                      name: o.name,
                      email: o.email,
                      phone: o.phone,
                      relationship: o.relationship,
                      token: o.token,
                      revokedAt: o.revoked_at,
                      lastViewedAt: o.last_viewed_at,
                    })
                  )}
                />
              </div>
            ),
          },
          ...(!seen.jobMoney ? [] : [{
            id: "payment",
            title: "Payment",
            hint: `${paymentPlans.length} plan${paymentPlans.length === 1 ? "" : "s"}`,
            body: (
              <div className="flex flex-col gap-4">
                <PaymentPlanPanel
                  jobId={jobId}
                  customerId={job.property?.customers?.id ?? null}
                  plans={paymentPlans}
                  suggestedTotal={proposal?.total_cost ?? null}
                  stripeReady={isStripeConfigured}
                />
                {(can.invoice.available || invoice) && (
                  <InvoiceSection
                    jobId={jobId}
                    invoice={invoice}
                    acceptedLabel={respondedLabel}
                    agreedTotal={proposal?.total_cost ?? null}
                    stripeReady={isStripeConfigured}
                  />
                )}
              </div>
            ),
          }]),
          ...(!seen.jobMoney ? [] : [{
            id: "invoice",
            title: "Invoice",
            hint: invoice ? "Raised" : can.invoice.available ? "Ready to raise" : "Not raised",
            lockedReason: can.invoice.available || invoice ? null : can.invoice.reason,
            body: (
              <InvoiceSection
                jobId={jobId}
                invoice={invoice}
                acceptedLabel={respondedLabel}
                agreedTotal={proposal?.total_cost ?? null}
                stripeReady={isStripeConfigured}
              />
            ),
          }]),
          {
            id: "messages",
            title: "Notes and client conversation",
            hint: `${internalMessages.length + externalMessages.length} message${
              internalMessages.length + externalMessages.length === 1 ? "" : "s"
            }`,
            body: (
              <div className="flex flex-col gap-4">
                {isTwilioConfigured && <CallClientButton jobId={jobId} />}
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
                  footnote={
                    isTwilioConfigured
                      ? "Also sent as a text message."
                      : "Add Twilio to also send this as a text."
                  }
                />
              </div>
            ),
          },
          {
            id: "marketing",
            title: "Before and after posts",
            hint: `${socialPosts.length} post${socialPosts.length === 1 ? "" : "s"}`,
            body: <BeforeAfterPanel posts={socialPosts} />,
          },
          ...(hasClientRequest
            ? [
                {
                  id: "request",
                  title: "What the client asked for",
                  hint: requestedServiceNames.join(", ") || null,
                  body: (
                    <div className="flex flex-col gap-1 text-sm">
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
                  ),
                },
              ]
            : []),
        ]}
      />

    </div>
  );
}

/**
 * What is stopping this job, first thing.
 *
 * Not a status but the checks themselves, so somebody reading NOT READY knows
 * which one thing to go and fix.
 */
async function OverviewTab(jobId: string, roles: string[], viewer: Profile | null) {
  const [facts, issues, overrides, commission] = await Promise.all([
    jobFacts(jobId),
    listJobIssues(jobId).catch(() => []),
    listGateOverrides(jobId).catch(() => ({}) as Awaited<ReturnType<typeof listGateOverrides>>),
    // Nothing for anybody who neither manages this client nor runs the money:
    // what a colleague earns is not everybody's business.
    viewer ? getJobCommission(jobId, viewer).catch(() => null) : null,
  ]);
  // Which gate matters depends on where the job is: quoting work is judged on
  // whether it can be quoted, sold work on whether it can start, and work in
  // hand on whether it can be closed.
  const gate = facts.status === "estimating" ? "proposal" : facts.status === "approved" ? "ready" : "closeout";
  const result = evaluateGate(gate, facts, issues, overrides[gate] ?? []);
  return (
    <div className="space-y-3">
      <ReadinessPanel jobId={jobId} result={result} canOverride={canOverrideGate(roles)} />
      {commission && <JobCommissionPanel commission={commission} />}
      {/* The way to clear a failing confirmation, on the screen that reports
          it failing. */}
      {gate === "ready" && (
        <ConfirmationsPanel
          jobId={jobId}
          states={{ materials: facts.materials, equipment: facts.equipment, access: facts.access }}
          sources={{
            materials: facts.materialsSource,
            equipment: facts.equipmentSource,
            access: facts.accessSource,
          }}
        />
      )}
    </div>
  );
}

async function FieldTab(jobId: string, address: string | null, phone: string | null, roles: string[]) {
  const [facts, issues, additions, progress] = await Promise.all([
    jobFacts(jobId),
    listJobIssues(jobId).catch(() => []),
    // Only what the client has actually approved. An unapproved change request
    // is deliberately not on this screen: the crew's copy of "what may I do"
    // has to be the same as the client's copy of "what did I agree to".
    executableAdditions(jobId).catch(() => []),
    jobProgress(jobId).catch(() => ({ units: [], summary: null })),
  ]);
  const scopeLines = facts.servicesDefined ? ["See the site plan for the areas and measurements."] : [];
  return (
    <FieldScreen
      jobId={jobId}
      address={address}
      scopeLines={scopeLines}
      clientPhone={phone}
      issues={issues}
      canDecideBlocking={canOverrideGate(roles)}
      approvedAdditions={additions}
      progress={progress.units}
    />
  );
}

/**
 * Everything unresolved about this job, in the order somebody would deal with
 * it: what the field reported, what the client is being asked to agree, what
 * is blocking, and then the record of what was decided.
 */
async function IssuesTab(jobId: string, roles: string[]) {
  const keys = roleKeysOf(roles);
  const [issues, exceptions, changes, assignments, events] = await Promise.all([
    listJobIssues(jobId).catch(() => []),
    listJobExceptions(jobId).catch(() => []),
    listScopeChanges(jobId).catch(() => []),
    listCrewAssignments(jobId).catch(() => []),
    listAuditEvents(jobId).catch(() => []),
  ]);

  // Worked out on the server, per kind, and sent as an answer rather than as
  // the roles themselves -- the client component never has to decide who
  // somebody is.
  const canDecide = Object.fromEntries(EXCEPTION_KINDS.map((kind) => [kind, canDecideException(keys, kind)]));

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Reported from the field</h3>
        <ExceptionsPanel exceptions={exceptions} canDecide={canDecide} />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Change requests</h3>
        <ScopeChangesPanel changes={changes} canReview={canReviewScopeChange(keys)} />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Issues</h3>
        <IssuesPanel jobId={jobId} issues={issues} canDecideBlocking={canOverrideGate(roles)} />
      </section>

      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm font-semibold">History</summary>
        <div className="mt-3">
          <JobHistory assignments={assignments} events={events} />
        </div>
      </details>
    </div>
  );
}

/** The gate between "the field work looks done" and "this job is closed". */
async function CloseoutTab(jobId: string, roles: string[]) {
  const [facts, issues, overrides] = await Promise.all([
    jobFacts(jobId),
    listJobIssues(jobId).catch(() => []),
    listGateOverrides(jobId).catch(() => ({}) as Awaited<ReturnType<typeof listGateOverrides>>),
  ]);
  return (
    <div className="space-y-3">
      <ReadinessPanel
        jobId={jobId}
        result={evaluateGate("closeout", facts, issues, overrides.closeout ?? [])}
        canOverride={canOverrideGate(roles)}
      />
      <ReadinessPanel
        jobId={jobId}
        result={evaluateGate("completed", facts, issues, overrides.completed ?? [])}
        canOverride={canOverrideGate(roles)}
      />
    </div>
  );
}
