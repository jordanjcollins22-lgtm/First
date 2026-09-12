import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { outboundBaseUrl } from "@/lib/base-url";
import {
  tallyByGroup,
  tallyByKind,
  tallyByPage,
  tallyByPerson,
  totals,
  trackedLink,
  type Funnel,
  type GroupTally,
  type KindTally,
  type OutreachKind,
  type OutreachResponse,
  type OutreachRow,
  type PageTally,
  type PersonTally,
  type Platform,
} from "@/lib/outreach-links";

/**
 * Every link handed out, and what came back.
 *
 * A booking carries the code it arrived through, so the two are joined on that
 * rather than guessed at from a date. Bounded: the board shows the recent ones
 * and the tallies, not every link since the beginning.
 */

export interface OutreachListRow extends OutreachRow {
  note: string | null;
  /** The reply that was written for the post, kept so it can be copied again. */
  comment: string | null;
  /** The reply as it actually went up, when the person has said. */
  postedComment: string | null;
  postedCommentAt: string | null;
  /** Where the link goes, ready to paste. Rebuilt rather than stored: the
   * route is what a code turns into, and a stored URL goes stale the day the
   * domain changes. */
  link: string;
  service: string | null;
  screenshotPath: string | null;
  firstClickAt: string | null;
  lastClickAt: string | null;
  respondedAt: string | null;
  /** Whether a booking has come through carrying this code. */
  booked: boolean;
  personName: string;
}

export interface OutreachBoard {
  rows: OutreachListRow[];
  groups: GroupTally[];
  people: (PersonTally & { name: string })[];
  kinds: KindTally[];
  pages: PageTally[];
  total: Funnel;
}

const PAGE = 200;

export async function getOutreachBoard(): Promise<OutreachBoard> {
  const supabase = await createClient();
  const [organizationId, baseUrl] = await Promise.all([
    getCurrentOrganizationId(),
    outboundBaseUrl(),
  ]);

  const { data } = await supabase
    .from("outreach_links")
    .select(
      "id, code, kind, platform, audience, from_page, sent_to, note, service, screenshot_path, profile_id, posted_at, click_count, first_click_at, last_click_at, responded_at, response, comment, posted_comment, posted_comment_at"
    )
    .eq("organization_id", organizationId)
    .order("posted_at", { ascending: false })
    .limit(PAGE);

  const raw = data ?? [];
  if (raw.length === 0) {
    return {
      rows: [],
      groups: [],
      people: [],
      kinds: [],
      pages: [],
      total: { posts: 0, clicked: 0, clicks: 0, replied: 0, bookings: 0 },
    };
  }

  const codes = raw.map((row) => row.code);
  const [{ data: booked }, { data: profiles }] = await Promise.all([
    supabase.from("jobs").select("referral_code").in("referral_code", codes),
    supabase.from("profiles").select("id, full_name, email").eq("organization_id", organizationId),
  ]);

  const bookedCodes = new Set(
    (booked ?? []).map((job) => job.referral_code).filter((code): code is string => Boolean(code))
  );
  const nameOf = new Map(
    (profiles ?? []).map((p) => [p.id, (p.full_name ?? "").trim() || (p.email ?? "").split("@")[0] || "Somebody"])
  );

  const rows: OutreachListRow[] = raw.map((row) => ({
    id: row.id,
    code: row.code,
    kind: (row.kind as OutreachKind) ?? "comment",
    platform: row.platform as Platform,
    audience: row.audience,
    fromPage: row.from_page,
    sentTo: row.sent_to,
    profileId: row.profile_id,
    postedAt: row.posted_at,
    clickCount: row.click_count ?? 0,
    response: (row.response as OutreachResponse | null) ?? null,
    note: row.note,
    comment: row.comment,
    postedComment: row.posted_comment ?? null,
    postedCommentAt: row.posted_comment_at ?? null,
    link: trackedLink(baseUrl, row.code),
    service: row.service,
    screenshotPath: row.screenshot_path,
    firstClickAt: row.first_click_at,
    lastClickAt: row.last_click_at,
    respondedAt: row.responded_at,
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
    kinds: tallyByKind(rows, bookedCodes),
    pages: tallyByPage(rows, bookedCodes),
    total: totals(rows, bookedCodes),
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
