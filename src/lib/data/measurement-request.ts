import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import type { WorkZone } from "@/components/canvas/types";
import type { CanvasCatalog } from "@/lib/data/canvas-catalog";
import { outboundBaseUrl } from "@/lib/base-url";
import { sendEmail } from "@/lib/email/send";
import { textToHtml } from "@/lib/email/plain";
import { approvalRequired, notifyApprovers, queueApproval } from "@/lib/data/outbound-approvals";
import { staleAfter } from "@/lib/outbound-approval";
import { measurementRequestEmail, unmeasuredZones, type MeasurableZone } from "@/lib/measurement-request";
import { zoneServiceCount } from "@/lib/proposal-pricing";
import { log } from "@/lib/log";

type Admin = SupabaseClient<Database>;

export type MeasurementRequestOutcome =
  | { asked: false; why: "all_measured" | "no_evaluator" | "no_email" }
  | { asked: true; how: "queued" | "sent" | "already"; zones: string[]; to: string };

/**
 * Asks the evaluator for the measurements the site map is missing.
 *
 * Runs when a proposal is built. One email per set of unmeasured areas on
 * a job: measuring one and rebuilding asks again only for what is still
 * missing. Where the business holds automatic emails for approval, this
 * waits there like the rest; otherwise it goes straight out.
 */
export async function requestMeasurements(
  admin: Admin,
  input: { jobId: string; zones: WorkZone[]; catalog: CanvasCatalog; serviceLabel: (zone: WorkZone) => string | null }
): Promise<MeasurementRequestOutcome> {
  const basisOf = new Map(input.catalog.servicePricing.map((p) => [p.service_type_id, p.pricing_basis]));
  const measurable: MeasurableZone[] = input.zones
    .filter((z) => z.service)
    .map((z) => {
      const basis = basisOf.get(z.service!.typeId);
      return {
        name: z.name,
        serviceLabel: input.serviceLabel(z),
        basis: basis === "area" || basis === "perimeter" || basis === "count" || basis === "flat" ? basis : null,
        measurementKind: z.measurementKind ?? null,
        lengthFt: z.lengthFt ?? null,
        widthFt: z.widthFt ?? null,
        areaSqFt: z.areaSqFt,
        perimeterFt: z.perimeterFt,
        quantity: z.service?.values?.quantity != null && z.service.values.quantity !== "" ? zoneServiceCount(z) : null,
      };
    });
  const missing = unmeasuredZones(measurable);
  if (missing.length === 0) return { asked: false, why: "all_measured" };

  type Row = {
    id: string;
    assigned_to: string | null;
    evaluator: { full_name: string | null; first_name: string | null; email: string | null } | null;
    property: { address: string; customer: { name: string; organization_id: string } };
  };
  const { data } = await admin
    .from("jobs")
    .select("id, assigned_to, evaluator:profiles!jobs_assigned_to_fkey(full_name, first_name, email), property:properties!inner(address, customer:customers!inner(name, organization_id))")
    .eq("id", input.jobId)
    .maybeSingle();
  const job = data as unknown as Row | null;
  if (!job?.assigned_to) return { asked: false, why: "no_evaluator" };
  const to = job.evaluator?.email?.trim();
  if (!to) return { asked: false, why: "no_email" };
  const organizationId = job.property.customer.organization_id;

  const { data: org } = await admin.from("organizations").select("name").eq("id", organizationId).maybeSingle();
  const email = measurementRequestEmail({
    evaluatorName: job.evaluator?.first_name || job.evaluator?.full_name || null,
    clientName: job.property.customer.name,
    address: job.property.address,
    zones: missing,
    jobLink: `${await outboundBaseUrl()}/jobs/${job.id}`,
    businessName: org?.name ?? "",
  });
  const names = missing.map((z) => z.name);
  const dedupeKey = `measurements_request:${job.id}:${[...names].sort().join("|")}`;
  const toName = job.evaluator?.full_name ?? null;

  if (await approvalRequired(admin, organizationId)) {
    const queued = await queueApproval(admin, {
      organizationId,
      source: "team_request",
      kind: "measurements_request",
      dedupeKey,
      customerId: null,
      jobId: job.id,
      toEmail: to,
      toName,
      subject: email.subject,
      body: email.text,
      expiresAt: staleAfter("measurements_request", new Date()),
    });
    if (queued === "queued") await notifyApprovers(admin, organizationId).catch(() => {});
    return { asked: true, how: queued, zones: names, to };
  }

  const sent = await sendEmail({ organizationId, to, subject: email.subject, html: textToHtml(email.text), text: email.text, stream: "transactional" });
  if (!sent.ok) log.warn("measurements_request.failed", { jobId: job.id, error: sent.message });
  return { asked: true, how: "sent", zones: names, to };
}
