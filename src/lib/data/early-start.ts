import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { localDayKey } from "@/lib/data/crew-day";
import { openRequests, type EarlyStartRequest } from "@/lib/early-start";

/** A pending request with enough around it to answer without opening the job. */
export interface PendingEarlyStart extends EarlyStartRequest {
  jobId: string;
  crewName: string;
  customerName: string;
  address: string;
  bookedFor: string;
  note: string | null;
}

/**
 * Requests waiting on this person.
 *
 * Scoped to the customers they actually manage, unless they are an admin —
 * an account manager wants their own queue, and a list that includes
 * everybody else's is a list that gets ignored.
 */
export async function pendingEarlyStarts(): Promise<PendingEarlyStart[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];

  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();

  const { data } = await supabase
    .from("early_start_requests")
    .select(
      "id, session_id, job_id, status, requested_for, decline_reason, note, profiles:requested_by(full_name), job_work_sessions(starts_on), jobs(properties(address, customers(name, account_manager_id)))"
    )
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .order("requested_for", { ascending: true });

  type Row = {
    id: string;
    session_id: string;
    job_id: string;
    status: string;
    requested_for: string;
    decline_reason: string | null;
    note: string | null;
    profiles: { full_name: string | null } | null;
    job_work_sessions: { starts_on: string } | null;
    jobs: {
      properties: {
        address: string;
        customers: { name: string; account_manager_id: string | null } | null;
      } | null;
    } | null;
  };

  const isAdmin = profile.roles.includes("admin");

  const rows = ((data ?? []) as unknown as Row[])
    .filter((r) => {
      if (isAdmin) return true;
      return r.jobs?.properties?.customers?.account_manager_id === profile.id;
    })
    .map<PendingEarlyStart>((r) => ({
      id: r.id,
      sessionId: r.session_id,
      jobId: r.job_id,
      status: "pending",
      requestedFor: r.requested_for,
      declineReason: r.decline_reason,
      note: r.note,
      crewName: r.profiles?.full_name ?? "A crew member",
      customerName: r.jobs?.properties?.customers?.name ?? "Client",
      address: r.jobs?.properties?.address ?? "Address missing",
      bookedFor: r.job_work_sessions?.starts_on ?? r.requested_for,
    }));

  // A request to start early on a day that has passed is not a decision
  // anybody still has to make, and leaving it in the queue teaches people to
  // stop reading the queue.
  return openRequests(rows, localDayKey());
}
