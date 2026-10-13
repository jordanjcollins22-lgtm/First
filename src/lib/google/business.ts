/**
 * Google Business Profile: the listing people find on Maps and in Search.
 *
 * Four things the app does with it: reads the reviews, answers them, posts
 * the week's best before-and-after, and reads how many people called, asked
 * for directions or clicked through to the website. Each is one call to one
 * of Google's Business Profile APIs, made with an access token from oauth.ts.
 *
 * Server only. Nothing here throws: every call answers ok or not, with a
 * sentence, so a run can carry on past one that failed.
 */

const ACCOUNTS = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO = "https://mybusinessbusinessinformation.googleapis.com/v1";
const V4 = "https://mybusiness.googleapis.com/v4";
const PERFORMANCE = "https://businessprofileperformance.googleapis.com/v1";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function call<T>(token: string, url: string, init: RequestInit = {}): Promise<Result<T>> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
    });
    const json = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!response.ok || (json as { error?: unknown }).error) {
      return { ok: false, error: (json as { error?: { message?: string } }).error?.message ?? `Google answered ${response.status}.` };
    }
    return { ok: true, value: json };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not reach Google." };
  }
}

export interface BusinessLocation {
  account: string;
  location: string;
  title: string;
}

/** The first account and location this sign-in can manage, or the one named. */
export async function findLocation(token: string, wanted?: string | null): Promise<Result<BusinessLocation>> {
  const accounts = await call<{ accounts?: { name: string }[] }>(token, `${ACCOUNTS}/accounts`);
  if (!accounts.ok) return accounts;
  for (const account of accounts.value.accounts ?? []) {
    const locations = await call<{ locations?: { name: string; title?: string }[] }>(
      token,
      `${INFO}/${account.name}/locations?readMask=name,title&pageSize=100`
    );
    if (!locations.ok) continue;
    for (const loc of locations.value.locations ?? []) {
      if (!wanted || loc.name === wanted || loc.name.endsWith(`/${wanted}`)) {
        return { ok: true, value: { account: account.name, location: loc.name, title: loc.title ?? "" } };
      }
    }
  }
  return { ok: false, error: "This Google sign-in doesn't manage any Business Profile location." };
}

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export interface PulledReview {
  name: string;
  author: string | null;
  stars: number | null;
  body: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  reply: string | null;
}

/** "accounts/1/locations/2" from the two names, as the v4 API wants it. */
function v4Location(loc: BusinessLocation): string {
  const id = loc.location.split("/").pop();
  return `${loc.account}/locations/${id}`;
}

/** The newest reviews, up to `max`. */
export async function listReviews(token: string, loc: BusinessLocation, max = 200): Promise<Result<PulledReview[]>> {
  const out: PulledReview[] = [];
  let pageToken = "";
  for (let page = 0; page < 10 && out.length < max; page++) {
    const url = `${V4}/${v4Location(loc)}/reviews?pageSize=50&orderBy=updateTime%20desc${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const r = await call<{
      reviews?: {
        name: string;
        reviewer?: { displayName?: string };
        starRating?: string;
        comment?: string;
        createTime?: string;
        updateTime?: string;
        reviewReply?: { comment?: string };
      }[];
      nextPageToken?: string;
    }>(token, url);
    if (!r.ok) return page === 0 ? r : { ok: true, value: out };
    for (const rv of r.value.reviews ?? []) {
      out.push({
        name: rv.name,
        author: rv.reviewer?.displayName ?? null,
        stars: rv.starRating ? (STARS[rv.starRating] ?? null) : null,
        // Google appends a machine translation after this marker; keep the original.
        body: rv.comment ? rv.comment.split("(Translated by Google)")[0].trim() || null : null,
        createdAt: rv.createTime ?? null,
        updatedAt: rv.updateTime ?? null,
        reply: rv.reviewReply?.comment ?? null,
      });
    }
    if (!r.value.nextPageToken) break;
    pageToken = r.value.nextPageToken;
  }
  return { ok: true, value: out.slice(0, max) };
}

export async function replyToReview(token: string, reviewName: string, comment: string): Promise<Result<null>> {
  const r = await call<unknown>(token, `${V4}/${reviewName}/reply`, { method: "PUT", body: JSON.stringify({ comment }) });
  return r.ok ? { ok: true, value: null } : r;
}

/** One photo post on the listing, with a button to book. */
export async function createPhotoPost(
  token: string,
  loc: BusinessLocation,
  post: { summary: string; imageUrl: string; bookUrl: string }
): Promise<Result<string>> {
  const r = await call<{ name?: string }>(token, `${V4}/${v4Location(loc)}/localPosts`, {
    method: "POST",
    body: JSON.stringify({
      languageCode: "en-US",
      topicType: "STANDARD",
      summary: post.summary.slice(0, 1500),
      media: [{ mediaFormat: "PHOTO", sourceUrl: post.imageUrl }],
      callToAction: { actionType: "BOOK", url: post.bookUrl },
    }),
  });
  return r.ok ? { ok: true, value: r.value.name ?? "" } : r;
}

export interface DailyInsight {
  day: string;
  calls: number;
  directions: number;
  websiteClicks: number;
}

const METRICS = { CALL_CLICKS: "calls", BUSINESS_DIRECTION_REQUESTS: "directions", WEBSITE_CLICKS: "websiteClicks" } as const;

/** Calls, direction requests and website clicks per day between two dates (YYYY-MM-DD). */
export async function fetchInsights(token: string, loc: BusinessLocation, start: string, end: string): Promise<Result<DailyInsight[]>> {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const params = new URLSearchParams();
  for (const m of Object.keys(METRICS)) params.append("dailyMetrics", m);
  params.set("dailyRange.start_date.year", String(sy));
  params.set("dailyRange.start_date.month", String(sm));
  params.set("dailyRange.start_date.day", String(sd));
  params.set("dailyRange.end_date.year", String(ey));
  params.set("dailyRange.end_date.month", String(em));
  params.set("dailyRange.end_date.day", String(ed));
  const r = await call<{
    multiDailyMetricTimeSeries?: {
      dailyMetricTimeSeries?: {
        dailyMetric?: string;
        timeSeries?: { datedValues?: { date?: { year: number; month: number; day: number }; value?: string }[] };
      }[];
    }[];
  }>(token, `${PERFORMANCE}/${loc.location}:fetchMultiDailyMetricsTimeSeries?${params.toString()}`);
  if (!r.ok) return r;
  const byDay = new Map<string, DailyInsight>();
  for (const group of r.value.multiDailyMetricTimeSeries ?? []) {
    for (const series of group.dailyMetricTimeSeries ?? []) {
      const key = METRICS[series.dailyMetric as keyof typeof METRICS];
      if (!key) continue;
      for (const v of series.timeSeries?.datedValues ?? []) {
        if (!v.date) continue;
        const day = `${v.date.year}-${String(v.date.month).padStart(2, "0")}-${String(v.date.day).padStart(2, "0")}`;
        const row = byDay.get(day) ?? { day, calls: 0, directions: 0, websiteClicks: 0 };
        row[key] = Number(v.value ?? 0) || 0;
        byDay.set(day, row);
      }
    }
  }
  return { ok: true, value: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)) };
}
