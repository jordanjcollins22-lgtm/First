import { createAdminClient } from "@/lib/supabase/admin";
import { canDoEvaluations } from "@/lib/affiliate-roles";
import type { BookedTime } from "@/lib/booking-availability";
import type { BookedNearby } from "@/lib/booking-recommendation";
import { embeddedOne } from "@/lib/postgrest";
import type { DayOff, WeeklyAvailability } from "@/types/domain";

export interface BookingContext {
  organizationId: string;
  organizationName: string;
  /** The specific profile whose link this was, if any — for lead attribution. */
  referredByProfileId: string | null;
  /** Set only when the link belongs to an evaluator themselves — books with them alone. */
  dedicatedEvaluatorId: string | null;
}

/**
 * Resolves the public /book link.
 *
 * `?ref=<personal affiliate slug>` books with, or is attributed to, that
 * person; `?org=<org slug>` is the business's own general link; and `?rec=` is
 * the code on one posted recommendation.
 *
 * The last of those is a fallback rather than a route in its own right, and it
 * exists because links get shared and then outlive whatever they named. A
 * recommendation code already knows which business it belongs to and who
 * posted it, so a link carrying nothing else is still answerable -- including
 * every link that went out before the org slug was put on them, which are in
 * strangers' Facebook threads and cannot be edited.
 */
export async function resolveBookingContext(params: {
  ref?: string;
  org?: string;
  rec?: string;
}): Promise<BookingContext | null> {
  const admin = createAdminClient();

  if (params.ref) {
    const { data: profile, error } = await admin
      .from("profiles")
      .select("id, organization_id")
      .eq("affiliate_slug", params.ref)
      .maybeSingle();
    if (error) throw error;
    // A referrer who has left, or a slug that was regenerated, must not take
    // the whole link down with it. The organisation on the same link is still
    // a perfectly good answer to "whose calendar is this", and the booking
    // simply arrives with nobody credited rather than not arriving.
    if (!profile) return fallback(admin, params);

    const [{ data: roleRows, error: roleError }, { data: org, error: orgError }] = await Promise.all([
      admin.from("profile_roles").select("role_name").eq("profile_id", profile.id),
      admin.from("organizations").select("id, name").eq("id", profile.organization_id).maybeSingle(),
    ]);
    if (roleError) throw roleError;
    if (orgError) throw orgError;
    if (!org) return fallback(admin, params);

    // Their own link books with them, whichever of the two roles they hold.
    // An account manager handing out a link and then not being offered on it
    // is the link doing the opposite of what they handed it out for.
    const roles = (roleRows ?? []).map((r) => r.role_name);

    return {
      organizationId: org.id,
      organizationName: org.name,
      referredByProfileId: profile.id,
      dedicatedEvaluatorId: canDoEvaluations(roles) ? profile.id : null,
    };
  }

  return fallback(admin, params);
}

/** The organisation, then the recommendation code, then nothing. */
async function fallback(
  admin: ReturnType<typeof createAdminClient>,
  params: { org?: string; rec?: string }
): Promise<BookingContext | null> {
  if (params.org) {
    const byOrg = await resolveByOrg(admin, params.org);
    if (byOrg) return byOrg;
  }
  if (params.rec) return resolveByRecommendation(admin, params.rec);
  return null;
}

/**
 * The business behind one posted reply.
 *
 * Credits whoever posted it, which is the same person the code already counts
 * the booking against, so a link with nothing but a code on it loses nothing.
 */
async function resolveByRecommendation(
  admin: ReturnType<typeof createAdminClient>,
  code: string
): Promise<BookingContext | null> {
  const { data: recommendation } = await admin
    .from("outreach_links")
    .select("organization_id, profile_id")
    .eq("code", code)
    .maybeSingle();
  if (!recommendation) return null;

  const { data: org } = await admin
    .from("organizations")
    .select("id, name")
    .eq("id", recommendation.organization_id)
    .maybeSingle();
  if (!org) return null;

  return {
    organizationId: org.id,
    organizationName: org.name,
    referredByProfileId: recommendation.profile_id,
    dedicatedEvaluatorId: null,
  };
}

/** The business by its public slug, with nobody credited for the referral. */
async function resolveByOrg(
  admin: ReturnType<typeof createAdminClient>,
  slug: string
): Promise<BookingContext | null> {
  const { data: org, error } = await admin
    .from("organizations")
    .select("id, name")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!org) return null;
  return {
    organizationId: org.id,
    organizationName: org.name,
    referredByProfileId: null,
    dedicatedEvaluatorId: null,
  };
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
    .filter((p) => canDoEvaluations(rolesByProfile.get(p.id) ?? []))
    .map((p) => p.id);
}

export interface AvailabilityData {
  weeklyAvailability: WeeklyAvailability[];
  daysOff: DayOff[];
  bookedTimes: BookedTime[];
  /**
   * Where the already-booked evaluations are, for working out which free hour
   * sits next to one near the caller.
   *
   * This never leaves the server. It is somebody's home address reduced to two
   * numbers, and the booking page is opened by strangers -- so the ranking is
   * done here and only the answer ("we're already close by around then") is
   * sent to the browser.
   */
  bookedPlaces: BookedNearby[];
}

export async function listAvailabilityData(evaluatorIds: string[]): Promise<AvailabilityData> {
  if (evaluatorIds.length === 0) {
    return { weeklyAvailability: [], daysOff: [], bookedTimes: [], bookedPlaces: [] };
  }

  const admin = createAdminClient();
  const [{ data: weekly, error: weeklyError }, { data: daysOff, error: daysOffError }, { data: jobs, error: jobsError }] =
    await Promise.all([
      admin.from("availability_weekly").select("*").in("profile_id", evaluatorIds),
      admin.from("availability_days_off").select("*").in("profile_id", evaluatorIds),
      admin
        .from("jobs")
        .select("assigned_to, evaluation_date, evaluation_end_date, properties(lat, lng)")
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
      .map((j) => ({
        evaluatorId: j.assigned_to as string,
        iso: j.evaluation_date as string,
        endIso: j.evaluation_end_date,
      })),
    bookedPlaces: (jobs ?? [])
      .filter((j) => j.evaluation_date)
      .map((j) => {
        const place = embeddedOne(j.properties as { lat: number | null; lng: number | null } | null);
        return {
          iso: j.evaluation_date as string,
          endIso: j.evaluation_end_date,
          lat: place?.lat ?? null,
          lng: place?.lng ?? null,
        };
      })
      // An evaluation whose property was never put on the map cannot tell us
      // anything about travel, so it is left out rather than counted as being
      // at the origin.
      .filter((p) => p.lat != null && p.lng != null),
  };
}
