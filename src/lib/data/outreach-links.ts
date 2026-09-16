import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { outboundBaseUrl } from "@/lib/base-url";
import { loadMoney } from "@/lib/data/commission";
import { affiliatePipeline, type AffiliateBookingLine } from "@/lib/affiliate-pipeline";
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
  isConverted,
  outreachCommission,
  rankPeople,
  type OutreachCommission,
  type PersonStanding,
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
  /** Who posted the link this came through, and what it has earned them. */
  posterId: string;
  collected: number;
  contractValue: number | null;
  commission: OutreachCommission;
  lastPaidAt: string | null;
}

export interface OutreachBoard {
  rows: OutreachListRow[];
  /** Who booked, by the code they came through. */
  bookingsByCode: Record<string, OutreachBooking[]>;
  groups: GroupTally[];
  people: (PersonTally & { name: string })[];
  /** Everyone who posted, best first, with what closed and what it earned. */
  standings: PersonStanding[];
  kinds: KindTally[];
  pages: PageTally[];
  total: Funnel;
}

const PAGE = 200;

/**
 * @param onlyProfileId When set, only this person's links: what they handed
 * out and what came of it, and nobody else's. The owner reads the whole
 * board; everybody else reads their own. The leaderboard is everyone's
 * either way: the standings are worked out over the whole board before it
 * is narrowed, so a person can see where they stand without seeing what
 * anybody else wrote.
 */
export async function getOutreachBoard(options: { onlyProfileId?: string } = {}): Promise<OutreachBoard> {
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
      standings: [],
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
    supabase.from("profiles").select("id, full_name, email, commission_pct").eq("organization_id", organizationId),
  ]);

  // What each booking became, and what it earned whoever posted the link:
  // a share of what the client has paid, minus what has been handed over.
  const bookedJobIds = (booked ?? []).map((job) => job.id);
  const posterByCode = new Map(raw.map((row) => [row.code, row.profile_id]));
  const pctOf = new Map((profiles ?? []).map((p) => [p.id, p.commission_pct == null ? null : Number(p.commission_pct)]));
  const [money, { data: payoutRows }] = await Promise.all([
    loadMoney(bookedJobIds),
    bookedJobIds.length > 0
      ? supabase.from("commission_payouts").select("job_id, profile_id, amount, paid_at").in("job_id", bookedJobIds)
      : Promise.resolve({ data: [] as { job_id: string; profile_id: string; amount: number; paid_at: string }[] }),
  ]);
  const paidOutByJobAndPoster = new Map<string, { amount: number; last: string | null }>();
  for (const row of payoutRows ?? []) {
    const key = `${row.job_id}:${row.profile_id}`;
    const seen = paidOutByJobAndPoster.get(key) ?? { amount: 0, last: null };
    seen.amount += Number(row.amount) || 0;
    if (!seen.last || row.paid_at > seen.last) seen.last = row.paid_at;
    paidOutByJobAndPoster.set(key, seen);
  }

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
    const posterId = posterByCode.get(job.referral_code) ?? "";
    const collected = money.collected.get(job.id) ?? 0;
    const paid = paidOutByJobAndPoster.get(`${job.id}:${posterId}`) ?? { amount: 0, last: null };
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
      posterId,
      collected,
      contractValue: money.contract.get(job.id) ?? null,
      commission: outreachCommission({
        converted: isConverted(job.status, collected),
        pct: pctOf.get(posterId) ?? null,
        collected,
        paidOut: paid.amount,
      }),
      lastPaidAt: paid.last,
    });
    bookingsByCode[job.referral_code] = list;
  }
  const nameOf = new Map(
    (profiles ?? []).map((p) => [p.id, (p.full_name ?? "").trim() || (p.email ?? "").split("@")[0] || "Somebody"])
  );

  const allRows: OutreachListRow[] = raw.map((row) => ({
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

  const people = tallyByPerson(allRows, bookedCodes).map((person) => ({
    ...person,
    name: nameOf.get(person.profileId) ?? "Somebody",
  }));
  const allBookings = Object.values(bookingsByCode).flat();
  // The people who booked, with names and money but no phone or email: the
  // breakdown is for seeing where a link got to, not for ringing anybody.
  const bookingLinesByCode: Record<string, AffiliateBookingLine[]> = {};
  for (const [code, list] of Object.entries(bookingsByCode)) {
    bookingLinesByCode[code] = list.map((b) => ({
      jobId: b.jobId,
      name: b.name,
      converted: b.commission.converted,
      collected: b.collected,
      commissionEarned: b.commission.earned,
      commissionPaidOut: b.commission.paidOut,
    }));
  }
  const standings = rankPeople(
    people.map((person) => {
      const theirs = allBookings.filter((b) => b.posterId === person.profileId);
      // A person reading their own board keeps their own breakdown and
      // nobody else's; the owner keeps everybody's.
      const mayOpen = !options.onlyProfileId || options.onlyProfileId === person.profileId;
      return {
        ...person,
        closed: theirs.filter((b) => b.commission.converted).length,
        collected: theirs.reduce((sum, b) => sum + b.collected, 0),
        commissionEarned: theirs.reduce((sum, b) => sum + b.commission.earned, 0),
        commissionPaid: theirs.reduce((sum, b) => sum + b.commission.paidOut, 0),
        pipeline: mayOpen
          ? affiliatePipeline(
              allRows.filter((row) => row.profileId === person.profileId),
              bookingLinesByCode
            )
          : [],
      };
    })
  );

  // Narrowed after the standings: one person's board is their own links
  // and their own bookings, under a leaderboard that is everyone's.
  const rows = options.onlyProfileId ? allRows.filter((row) => row.profileId === options.onlyProfileId) : allRows;
  const ownCodes = new Set(rows.map((row) => row.code));
  const visibleBookings = options.onlyProfileId
    ? Object.fromEntries(Object.entries(bookingsByCode).filter(([code]) => ownCodes.has(code)))
    : bookingsByCode;

  return {
    rows,
    bookingsByCode: visibleBookings,
    groups: tallyByGroup(rows, bookedCodes),
    people,
    standings,
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
