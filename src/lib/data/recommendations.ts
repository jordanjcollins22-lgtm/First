import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { tallyByGroup, tallyByPerson, type GroupTally, type PersonTally, type RecommendationRow } from "@/lib/recommendations";

/**
 * The replies the team has posted, and what came back.
 *
 * A booking carries the code it was posted with, so the two are joined on
 * that rather than guessed at from a date. Bounded: the board shows the recent
 * ones and the tallies, not every reply since the beginning.
 */

export interface RecommendationListRow extends RecommendationRow {
  askedBy: string | null;
  note: string | null;
  screenshotPath: string | null;
  /** Whether a booking has come through carrying this code. */
  booked: boolean;
  personName: string;
}

export interface RecommendationBoard {
  rows: RecommendationListRow[];
  groups: GroupTally[];
  people: (PersonTally & { name: string })[];
  totalPosts: number;
  totalBookings: number;
}

const PAGE = 200;

export async function getRecommendationBoard(): Promise<RecommendationBoard> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();

  const { data } = await supabase
    .from("recommendations")
    .select("id, code, platform, group_name, asked_by, note, screenshot_path, profile_id, posted_at")
    .eq("organization_id", organizationId)
    .order("posted_at", { ascending: false })
    .limit(PAGE);

  const raw = data ?? [];
  if (raw.length === 0) {
    return { rows: [], groups: [], people: [], totalPosts: 0, totalBookings: 0 };
  }

  const codes = raw.map((row) => row.code);
  const [{ data: booked }, { data: profiles }] = await Promise.all([
    supabase.from("jobs").select("referral_code").in("referral_code", codes),
    supabase.from("profiles").select("id, full_name, email").eq("organization_id", organizationId),
  ]);

  const bookedCodes = new Set((booked ?? []).map((job) => job.referral_code).filter((c): c is string => Boolean(c)));
  const nameOf = new Map(
    (profiles ?? []).map((p) => [p.id, (p.full_name ?? "").trim() || (p.email ?? "").split("@")[0] || "Somebody"])
  );

  const rows: RecommendationListRow[] = raw.map((row) => ({
    id: row.id,
    code: row.code,
    platform: row.platform as RecommendationRow["platform"],
    groupName: row.group_name,
    profileId: row.profile_id,
    postedAt: row.posted_at,
    askedBy: row.asked_by,
    note: row.note,
    screenshotPath: row.screenshot_path,
    booked: bookedCodes.has(row.code),
    personName: nameOf.get(row.profile_id) ?? "Somebody",
  }));

  return {
    rows,
    groups: tallyByGroup(rows, bookedCodes),
    people: tallyByPerson(rows, bookedCodes).map((person) => ({
      ...person,
      name: nameOf.get(person.profileId) ?? "Somebody",
    })),
    totalPosts: rows.length,
    totalBookings: rows.filter((row) => row.booked).length,
  };
}

/**
 * A short-lived link to one screenshot.
 *
 * Signed rather than public: a screenshot of a group thread carries other
 * people's names and faces, and none of that belongs on an open URL.
 */
export async function screenshotUrl(path: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.storage.from("recommendation-shots").createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}
