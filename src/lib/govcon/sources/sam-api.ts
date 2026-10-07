import { fetchJson } from "../http";
import { blankToNull, normalizeDate, normalizeNoticeType, normalizeSetAside, parseMoney } from "../normalize";
import type { Opportunity } from "../types";

/**
 * Official SAM.gov Get Opportunities API (v2). Optional: needs SAM_API_KEY
 * (free, from sam.gov → Account Details). 10 calls/day without an entity
 * role, 1,000/day once the company's SAM registration gives the user a role.
 * The keyless daily CSV covers the same data, so the pipeline only uses
 * this for same-day freshness between CSV rebuilds.
 */
const BASE = "https://api.sam.gov/opportunities/v2/search";

interface ApiOpportunity {
  noticeId: string;
  title: string;
  solicitationNumber?: string;
  fullParentPathName?: string;
  postedDate?: string;
  type?: string;
  baseType?: string;
  typeOfSetAside?: string;
  typeOfSetAsideDescription?: string;
  responseDeadLine?: string;
  naicsCode?: string;
  classificationCode?: string;
  active?: string;
  award?: { amount?: string | number };
  pointOfContact?: Array<{ type?: string; fullName?: string; email?: string; phone?: string }>;
  placeOfPerformance?: {
    city?: { name?: string };
    state?: { code?: string };
    zip?: string;
    country?: { code?: string };
  };
  description?: string;
  uiLink?: string;
  resourceLinks?: string[] | null;
}

function mmddyyyy(d: Date): string {
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

export function apiToOpportunity(o: ApiOpportunity): Opportunity {
  const path = (o.fullParentPathName ?? "").split(".");
  return {
    externalId: o.noticeId,
    source: "sam_api",
    noticeType: normalizeNoticeType(o.type ?? o.baseType),
    title: o.title,
    solicitationNumber: blankToNull(o.solicitationNumber),
    agency: blankToNull(path[0]),
    office: blankToNull(path[path.length - 1]),
    naicsCode: blankToNull(o.naicsCode),
    pscCode: blankToNull(o.classificationCode),
    setAside: normalizeSetAside(o.typeOfSetAside),
    setAsideLabel: blankToNull(o.typeOfSetAsideDescription),
    postedDate: normalizeDate(o.postedDate),
    responseDeadline: normalizeDate(o.responseDeadLine),
    placeOfPerformance: {
      city: o.placeOfPerformance?.city?.name ?? null,
      state: o.placeOfPerformance?.state?.code ?? null,
      zip: o.placeOfPerformance?.zip?.slice(0, 5) ?? null,
      country: o.placeOfPerformance?.country?.code ?? null,
    },
    pointsOfContact: (o.pointOfContact ?? []).map((p) => ({
      type: p.type ?? null,
      name: p.fullName ?? null,
      email: p.email ?? null,
      phone: p.phone ?? null,
    })),
    // The API returns a URL here (costs a call to fetch); the analyze stage
    // pulls the full text through the keyless notice-detail endpoint instead.
    description: null,
    url: o.uiLink ?? `https://sam.gov/opp/${o.noticeId}/view`,
    attachmentUrls: o.resourceLinks ?? [],
    estimatedValue: parseMoney(o.award?.amount ?? null),
    active: (o.active ?? "Yes").toLowerCase() === "yes",
  };
}

/** Notices posted in the last `days` days (solicitations, combined, presol, sources sought). */
export async function searchRecentOpportunities(apiKey: string, days = 2): Promise<Opportunity[]> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const out: Opportunity[] = [];
  for (let offset = 0; offset < 10_000; offset += 1000) {
    const params = new URLSearchParams({
      api_key: apiKey,
      postedFrom: mmddyyyy(from),
      postedTo: mmddyyyy(to),
      ptype: "o,k,p,r",
      limit: "1000",
      offset: String(offset),
    });
    const data = await fetchJson<{ totalRecords: number; opportunitiesData?: ApiOpportunity[] }>(
      `${BASE}?${params}`
    );
    const page = data.opportunitiesData ?? [];
    out.push(...page.map(apiToOpportunity));
    if (page.length < 1000 || out.length >= data.totalRecords) break;
  }
  return out;
}
