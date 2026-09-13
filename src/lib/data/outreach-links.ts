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

/** One booking that arrived carrying a link's code, with the person behind it. */
export interface OutreachBooking {
  jobId: string;
  code: string;
  customerId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string;
  bookedAt: string;
  evaluationDate: string | null;
  evaluationStatus: string;
  jobStatus: string;
}

export interface OutreachBoard {
  rows: OutreachListRow[];
  /** Who booked, by the code they came through. */
  bookingsByCode: Record<string, OutreachBooking[]>;
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
      bookingsByCode: {},
      groups: [],
      people: [],
      kinds: [],
      pages: [],
      total: { posts: 0, clicked: 0, clicks: 0, replied: 0, bookings: 0 },
    };
  }

  const codes = raw.map((row) => row.code);
  const [{ data: booked }, { data: profiles }] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, referral_code, status, evaluation_status, evaluation_date, created_at, property:properties(address, customer:customers(id, name, phone, email))"
      )
      .in("referral_code", codes)
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email").eq("organization_id", organizationId),
  ]);

  const bookedCodes = new Set(
    (booked ?? []).map((job) => job.referral_code).filter((code): code is string => Boolean(code))
  );

  // The people, by code. Contact details are here because the person reading
  // this board is the one who will ring them; the leads screen is the same
  // trust level.
  const bookingsByCode: Record<string, OutreachBooking[]> = {};
  for (const job of (booked ?? []) as unknown as {
    id: string;
    referral_code: string | null;
    status: string;
    evaluation_status: string;
    evaluation_date: string | null;
    created_at: string;
    property: { address: string; customer: { id: string; name: string; phone: string | null; email: string | null } | null } | null;
  }[]) {
    if (!job.referral_code || !job.property?.customer) continue;
    const list = bookingsByCode[job.referral_code] ?? [];
    list.push({
      jobId: job.id,
      code: job.referral_code,
      customerId: job.property.customer.id,
      name: job.property.customer.name,
      phone: job.property.customer.phone,
      email: job.property.customer.email,
      address: job.property.address,
      bookedAt: job.created_at,
      evaluationDate: job.evaluation_date,
      evaluationStatus: job.evaluation_status,
      jobStatus: job.status,
    });
    bookingsByCode[job.referral_code] = list;
  }
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
    bookingsByCode,
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
