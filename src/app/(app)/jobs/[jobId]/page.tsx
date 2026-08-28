import Link from "next/link";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { getProposalForJob } from "@/lib/data/proposals";
import { viewsForJob } from "@/lib/data/proposal-views";
import { isWarm, viewLabel } from "@/lib/proposal-views";
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
import { PhotoReviewPanel } from "@/components/job/photo-review-panel";
import { isAccountManager as isManagerRole } from "@/lib/affiliate-roles";
import { beforesFromZones, notYetAdopted, type ZoneLike } from "@/lib/evaluation-befores";
import { getJobSchedule } from "@/lib/data/work-sessions";
import { capabilities, deriveStage, nextStep } from "@/lib/job-stage";
import { isMissingTable } from "@/lib/setup-errors";
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
import { BeforeAfterPanel } from "@/components/marketing/before-after-panel";
import { VisitsPanel } from "@/components/job/visits-panel";
import { LockedPanel, StageHeader } from "@/components/job/stage-header";
import { WalkthroughPanel } from "@/components/job/walkthrough-panel";
import { CrewPanel } from "@/components/job/crew-panel";
import { ObserversPanel, type ObserverRow } from "@/components/job/observers-panel";
import { WorkOrderView } from "@/components/job/work-order-view";
import { getWorkOrderForJob } from "@/lib/data/work-order";
import { formatJobNumber } from "@/lib/job-number";
import { isFieldOnly } from "@/lib/affiliate-roles";
import { computeJobTotals, allMaterialLineItems, formatMaterialQuantity } from "@/lib/proposal-pricing";
import { env, isSupabaseConfigured, isTwilioConfigured } from "@/lib/env";
import { resolveBaseUrl } from "@/lib/app-url";
import type { WorkZone } from "@/components/canvas/types";
import type { EvaluationStatus, JobCrewMember, JobStatus } from "@/types/domain";
import { requireJobAccess } from "@/lib/data/access";
import { getCurrentProfile, listProfiles } from "@/lib/data/team";
import { isAccountManager } from "@/lib/affiliate-roles";
import { serviceLabelFor } from "@/lib/zone-scope";

export default async function JobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { jobId } = await params;

  // Reachable from Project Data, the calendar and the pipeline — anyone who
  // can see the job in one of those can open it. Assignment counts too: a
  // crew member's Today screen links straight here, and being unable to open
  // the job you are standing on would make that link a dead end.
  await requireJobAccess(jobId, ["job-detail", "project-data", "evaluations", "pipeline"]);

  const supabase = await createClient();

  const { data: jobRow, error: jobError } = await supabase
    .from("jobs")
    .select("*, property:properties(address, lat, lng, customers(id, name))")
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
      customers: { id: string; name: string } | null;
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
  const { totalCost: serviceCost } = computeJobTotals(zones, catalog);
  const materialItems = allMaterialLineItems(zones, catalog);
  const materialsCost = materialItems.reduce((sum, item) => sum + (item.totalCost ?? 0), 0);
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

  const zoneBreakdowns: InternalZoneBreakdown[] = zones.map((zone) => {
    const def = zone.service ? serviceTypeById(zone.service.typeId) : undefined;
    // A service this business added itself has no built-in definition; its
    // name is on the pricing row. Without this the crew sheet showed a uuid.
    const pricingRow = zone.service ? pricingByType.get(zone.service.typeId) : undefined;
    const checklistAnswers = (def?.fields ?? [])
      .filter((field) => zone.service?.values[field.key])
      .map((field) => ({ label: field.label, value: zone.service!.values[field.key] }));
    return {
      zoneName: zone.name,
      serviceLabel: serviceLabelFor(def, pricingRow ? { name: pricingRow.name } : undefined),
      notes: zone.service?.notes ?? "",
      checklistAnswers,
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

      <StageHeader stage={stage} next={nextStep(stageInput)} />

      {/* Above the work panels because who is on the job decides whose Today
          screen it lands on — an unassigned job is invisible to the field. */}
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

      {/* Sits with the crew, because both answer "who is on this job" — one
          inside the business and one outside it. */}
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

      {/* Photos and sign-off. Which stages are offered depends on where the
          job is: there is no finished work to photograph before anyone has
          been on site. Shown whenever any stage is open, or whenever photos
          already exist, so a finished job never hides its own record. */}
      {can.photoBefore.available || photos.length > 0 ? (
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
      ) : (
        <LockedPanel
          title="Photos"
          reason={can.photoBefore.available ? "" : can.photoBefore.reason}
        />
      )}

      {/* What went out about this job, once somebody approved it going out. */}
      {/* The manager's check on the finished work, before the client sees
          it. Nobody senior has been back since the crew signed off. */}
      <PhotoReviewPanel
        jobId={jobId}
        photos={photos.filter((photo) => photo.kind === "after")}
        marks={photoMarks}
        crewSignedOff={job.status === "completed"}
        approvedAt={job.photos_approved_at ?? null}
        approvedByName={photosApprovedByName}
        canReview={canReviewPhotos}
      />

      {/* How the job gets paid for: one-off, split up, or recurring. */}
      <PaymentPlanPanel
        jobId={jobId}
        customerId={job.property?.customers?.id ?? null}
        plans={paymentPlans}
        suggestedTotal={proposal?.total_cost ?? null}
        stripeReady={isStripeConfigured}
      />

      <BeforeAfterPanel posts={socialPosts} />

      {/* Sits above Visits because on a live job it is the thing holding
          everything else up. */}
      {(can.requestWalkthrough.available || schedule.walkthroughs.length > 0) && (
        <WalkthroughPanel
          jobId={jobId}
          walkthroughs={schedule.walkthroughs}
          canRequest={can.requestWalkthrough.available}
          requestLockReason={can.requestWalkthrough.available ? null : can.requestWalkthrough.reason}
          canReview={canReviewWalk}
          namesById={namesById}
        />
      )}

      {canManageVisits || schedule.tickets.length > 0 ? (
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
      ) : (
        <LockedPanel title="Visits & tickets" reason={can.visits.available ? "" : can.visits.reason} />
      )}

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

      {can.proposal.available || proposal ? (
        <ProposalPanel
          jobId={jobId}
          proposal={proposal}
          baseUrl={baseUrl}
          serviceCost={serviceCost}
          materialsCost={materialsCost}
          zones={zoneBreakdowns}
          discounts={discounts}
          viewLabel={proposalViews ? viewLabel(proposalViews, new Date()) : null}
          viewsWarm={
            proposalViews ? isWarm(proposalViews, proposal?.status ?? "") : false
          }
        />
      ) : (
        <LockedPanel title="Proposal" reason={can.proposal.available ? "" : can.proposal.reason} />
      )}

      {(can.invoice.available || invoice) && <InvoicePanel invoice={invoice} />}

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
        evaluatorName={viewer?.full_name || viewer?.email || null}
      />
    </div>
  );
}
