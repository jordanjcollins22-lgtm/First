import { createAdminClient } from "@/lib/supabase/admin";
import { observerStage, type ObserverProject, type ObserverRelationship } from "@/lib/observers";
import { serviceTypeById } from "@/components/canvas/service-catalog";
import type { WorkZone } from "@/components/canvas/types";
import type { EvaluationStatus, JobStatus, WorkSessionStatus } from "@/types/domain";

async function safe<T>(query: PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  try {
    const { data } = await query;
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * A watcher's view of a project, by link.
 *
 * Read through the service role, like the proposal, because the person holding
 * the link has no account and never will. The token is the whole of their
 * access, so a revoked row returns nothing rather than a thinner page — a link
 * somebody turned off must stop working, not degrade.
 *
 * Money is not filtered out here. It is never fetched: no proposal, no
 * invoice, no discounts. There is nothing to leak because nothing was read.
 */
export async function getProgressByToken(token: string): Promise<ObserverProject | null> {
  const admin = createAdminClient();

  const { data: observerRow } = await admin
    .from("job_observers")
    .select("id, job_id, name, relationship, revoked_at, organization_id")
    .eq("token", token)
    .maybeSingle();

  const observer = observerRow as unknown as {
    id: string;
    job_id: string;
    name: string;
    relationship: ObserverRelationship;
    revoked_at: string | null;
    organization_id: string;
  } | null;
  if (!observer || observer.revoked_at) return null;

  const { data: jobRow } = await admin
    .from("jobs")
    .select(
      "id, status, evaluation_status, evaluation_date, completed_at, property_id, " +
        "property:properties(address, customer_id, customers(name, account_manager_id))"
    )
    .eq("id", observer.job_id)
    .maybeSingle();

  const job = jobRow as unknown as {
    id: string;
    status: JobStatus;
    evaluation_status: EvaluationStatus;
    evaluation_date: string | null;
    completed_at: string | null;
    property: {
      address: string;
      customers: { name: string; account_manager_id: string | null } | null;
    } | null;
  } | null;
  if (!job) return null;

  const [designs, sessionRows, orgRows, proposalStatusRows] = await Promise.all([
    safe(admin.from("canvas_designs").select("zones").eq("job_id", job.id)),
    safe(admin.from("job_work_sessions").select("starts_on, ends_on, status, purpose").eq("job_id", job.id)),
    safe(admin.from("organizations").select("name").eq("id", observer.organization_id)),
    // Status only. The proposal's total is deliberately not selected — a
    // watcher's page cannot leak a number it never read.
    safe(admin.from("job_proposals").select("status").eq("job_id", job.id)),
  ]);

  const sessions = sessionRows as unknown as {
    starts_on: string;
    ends_on: string;
    status: WorkSessionStatus;
    purpose: string | null;
  }[];

  const zones = ((designs[0] as unknown as { zones: WorkZone[] } | undefined)?.zones ?? []).filter(
    (z) => z.service
  );

  const managerId = job.property?.customers?.account_manager_id ?? null;
  let contact: ObserverProject["contact"] = null;
  if (managerId) {
    const { data: person } = await admin
      .from("profiles")
      .select("full_name, email, phone")
      .eq("id", managerId)
      .maybeSingle();
    const p = person as { full_name: string | null; email: string; phone: string | null } | null;
    if (p) contact = { name: p.full_name || p.email, phone: p.phone };
  }

  // Recorded quietly, so the office can tell a link that is being used from
  // one that was never opened.
  await admin
    .from("job_observers")
    .update({ last_viewed_at: new Date().toISOString() })
    .eq("id", observer.id);

  return {
    address: job.property?.address ?? "",
    customerName: job.property?.customers?.name ?? "",
    organizationName: (orgRows[0] as unknown as { name: string } | undefined)?.name ?? "",
    stage: observerStage({
      status: job.status,
      evaluationStatus: job.evaluation_status,
      evaluationDate: job.evaluation_date,
      proposalStatus: (proposalStatusRows[0] as unknown as { status: string } | undefined)?.status ?? null,
      sessions: sessions.map((s) => ({ status: s.status })),
    }),
    contact,
    zones: zones.map((zone) => ({
      name: zone.name,
      service:
        serviceTypeById(zone.service!.typeId)?.label ?? zone.service!.typeId,
      location: zone.location,
      notes: zone.service!.notes ?? "",
      photos: (zone.service!.photos ?? []).map((path) => ({
        path,
        markers: zone.service!.photoMarkers?.[path] ?? [],
      })),
    })),
    visits: sessions
      .filter((s) => s.status !== "cancelled")
      .map((s) => ({ startsOn: s.starts_on, endsOn: s.ends_on, status: s.status, purpose: s.purpose })),
    evaluationDate: job.evaluation_date,
    completedAt: job.completed_at,
    watcherName: observer.name,
    relationship: observer.relationship,
  };
}
