import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { checkFertilizerVisit } from "@/lib/compliance/fertilizer-blackout";
import { loadBackOfficeSettingsAdmin } from "@/lib/data/back-office-settings";
import { certifiedFertilizerOnFile } from "@/lib/data/compliance";

/**
 * The fertilizer blackout, applied to a real job.
 *
 * The lines come from what the client was sold (the proposal's snapshot:
 * each area's service label, scope text and the answers it was priced
 * from) and, before there is a proposal, from the services the job was
 * booked for. Returns the message to refuse with, or null to go ahead.
 *
 * Never throws and never blocks on its own failure: a guard that cannot
 * read the job lets the booking through rather than stopping the schedule.
 */
export async function fertilizerBlock(jobId: string, startsOn: string, endsOn: string): Promise<string | null> {
  try {
    const sb = createAdminClient() as unknown as SupabaseClient;
    const { data: job } = await sb.from("jobs").select("organization_id").eq("id", jobId).maybeSingle();
    const organizationId = (job as { organization_id: string } | null)?.organization_id;
    if (!organizationId) return null;
    const settings = await loadBackOfficeSettingsAdmin(organizationId);
    if (!settings.fertilizerGuardOn) return null;

    const lines = await jobServiceLines(sb, organizationId, jobId);
    if (lines.length === 0) return null;
    const verdict = checkFertilizerVisit({ startsOn, endsOn, lines, certifiedOnFile: await certifiedFertilizerOnFile(organizationId) });
    return verdict.ok ? null : verdict.message;
  } catch {
    return null;
  }
}

/** The words each line of work on a job is written in. */
export async function jobServiceLines(sb: SupabaseClient, organizationId: string, jobId: string): Promise<string[]> {
  const [{ data: proposal }, { data: requested }] = await Promise.all([
    sb.from("job_proposals").select("scope_snapshot").eq("job_id", jobId).maybeSingle(),
    sb.from("job_requested_services").select("service_type_id").eq("job_id", jobId),
  ]);
  const snapshot = ((proposal as { scope_snapshot: unknown } | null)?.scope_snapshot ?? []) as { serviceLabel?: string; scopeText?: string; facts?: string }[];
  const lines = Array.isArray(snapshot) ? snapshot.map((z) => [z.serviceLabel, z.scopeText, z.facts].filter(Boolean).join(" — ")).filter(Boolean) : [];
  const typeIds = ((requested ?? []) as { service_type_id: string }[]).map((r) => r.service_type_id);
  if (typeIds.length) {
    const { data: services } = await sb.from("services").select("name").eq("organization_id", organizationId).in("service_type_id", typeIds);
    for (const s of (services ?? []) as { name: string }[]) lines.push(s.name);
  }
  return lines;
}
