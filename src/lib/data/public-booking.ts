import { createAdminClient } from "@/lib/supabase/admin";
import type { BookedTime } from "@/lib/booking-availability";
import type { DayOff, WeeklyAvailability } from "@/types/domain";

export interface BookingContext {
  organizationId: string;
  organizationName: string;
  /** The specific profile whose link this was, if any — for lead attribution. */
  referredByProfileId: string | null;
  /** Set only when the link belongs to an evaluator themselves — books with them alone. */
  dedicatedEvaluatorId: string | null;
}

/** Resolves the public /book link: ?ref=<personal affiliate slug> books with (or is
 * attributed to) that person; ?org=<org slug> is the org's own general/ad link. */
export async function resolveBookingContext(params: {
  ref?: string;
  org?: string;
}): Promise<BookingContext | null> {
  const admin = createAdminClient();

  if (params.ref) {
    const { data: profile, error } = await admin
      .from("profiles")
      .select("id, organization_id")
      .eq("affiliate_slug", params.ref)
      .maybeSingle();
    if (error) throw error;
    if (!profile) return null;

    const [{ data: roleRows, error: roleError }, { data: org, error: orgError }] = await Promise.all([
      admin.from("profile_roles").select("role_name").eq("profile_id", profile.id),
      admin.from("organizations").select("id, name").eq("id", profile.organization_id).maybeSingle(),
    ]);
    if (roleError) throw roleError;
    if (orgError) throw orgError;
    if (!org) return null;

    const roles = (roleRows ?? []).map((r) => r.role_name);
    const isEvaluator = roles.some((r) => r.toLowerCase().trim() === "evaluator");

    return {
      organizationId: org.id,
      organizationName: org.name,
      referredByProfileId: profile.id,
      dedicatedEvaluatorId: isEvaluator ? profile.id : null,
    };
  }

  if (params.org) {
    const { data: org, error } = await admin
      .from("organizations")
      .select("id, name")
      .eq("slug", params.org)
      .maybeSingle();
    if (error) throw error;
    if (!org) return null;
    return { organizationId: org.id, organizationName: org.name, referredByProfileId: null, dedicatedEvaluatorId: null };
  }

  return null;
}

export interface PublicService {
  service_type_id: string;
  name: string;
}

export async function listPublicServices(organizationId: string): Promise<PublicService[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("services")
    .select("service_type_id, name")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

/** All evaluators in the org — used when the client didn't arrive via a specific
 * evaluator's own link (a generic ad, or an account manager's referral link). */
export async function listOrgEvaluatorIds(organizationId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data: profiles, error } = await admin.from("profiles").select("id").eq("organization_id", organizationId);
  if (error) throw error;
  if (!profiles || profiles.length === 0) return [];

  const { data: roleRows, error: roleError } = await admin
    .from("profile_roles")
    .select("profile_id, role_name")
    .in(
      "profile_id",
      profiles.map((p) => p.id)
    );
  if (roleError) throw roleError;

  const rolesByProfile = new Map<string, string[]>();
  for (const r of roleRows ?? []) {
    const list = rolesByProfile.get(r.profile_id) ?? [];
    list.push(r.role_name);
    rolesByProfile.set(r.profile_id, list);
  }

  return profiles
    .filter((p) => (rolesByProfile.get(p.id) ?? []).some((r) => r.toLowerCase().trim() === "evaluator"))
    .map((p) => p.id);
}

export interface AvailabilityData {
  weeklyAvailability: WeeklyAvailability[];
  daysOff: DayOff[];
  bookedTimes: BookedTime[];
}

export async function listAvailabilityData(evaluatorIds: string[]): Promise<AvailabilityData> {
  if (evaluatorIds.length === 0) return { weeklyAvailability: [], daysOff: [], bookedTimes: [] };

  const admin = createAdminClient();
  const [{ data: weekly, error: weeklyError }, { data: daysOff, error: daysOffError }, { data: jobs, error: jobsError }] =
    await Promise.all([
      admin.from("availability_weekly").select("*").in("profile_id", evaluatorIds),
      admin.from("availability_days_off").select("*").in("profile_id", evaluatorIds),
      admin
        .from("jobs")
        .select("assigned_to, evaluation_date")
        .in("assigned_to", evaluatorIds)
        .not("evaluation_date", "is", null)
        .neq("status", "cancelled"),
    ]);
  if (weeklyError) throw weeklyError;
  if (daysOffError) throw daysOffError;
  if (jobsError) throw jobsError;

  return {
    weeklyAvailability: (weekly ?? []) as unknown as WeeklyAvailability[],
    daysOff: (daysOff ?? []) as unknown as DayOff[],
    bookedTimes: (jobs ?? [])
      .filter((j) => j.assigned_to && j.evaluation_date)
      .map((j) => ({ evaluatorId: j.assigned_to as string, iso: j.evaluation_date as string })),
  };
}
