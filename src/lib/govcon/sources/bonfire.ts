import { fetchJson } from "../http";
import type { Opportunity } from "../types";

/**
 * State & local bids from Bonfire portals ({org}.bonfirehub.com). Each
 * portal exposes its open opportunities as public JSON (titles, reference
 * numbers, close dates, departments). Project pages and documents need a
 * free vendor login, so these flow into the pipeline as "needs_docs" until
 * someone uploads the bid documents.
 *
 * Every portal below was verified live on 2026-10-07. Add more from
 * Settings → Extra Bonfire portals.
 */
export interface BonfirePortal {
  subdomain: string;
  name: string;
  state: string;
  timeZone: string;
}

export const BONFIRE_PORTALS: BonfirePortal[] = [
  { subdomain: "utah", name: "State of Utah", state: "UT", timeZone: "America/Denver" },
  { subdomain: "charlottenc", name: "City of Charlotte", state: "NC", timeZone: "America/New_York" },
  { subdomain: "wake", name: "Wake County", state: "NC", timeZone: "America/New_York" },
  { subdomain: "fairfaxcounty", name: "Fairfax County", state: "VA", timeZone: "America/New_York" },
  { subdomain: "fcps", name: "Fairfax County Public Schools", state: "VA", timeZone: "America/New_York" },
  { subdomain: "hcpss", name: "Howard County Public Schools", state: "MD", timeZone: "America/New_York" },
  { subdomain: "alleghenycounty", name: "Allegheny County", state: "PA", timeZone: "America/New_York" },
  { subdomain: "hillsboroughcounty", name: "Hillsborough County", state: "FL", timeZone: "America/New_York" },
  { subdomain: "chathamcountyga", name: "Chatham County", state: "GA", timeZone: "America/New_York" },
  { subdomain: "bcsdk12", name: "Bibb County School District", state: "GA", timeZone: "America/New_York" },
  { subdomain: "cherokeek12", name: "Cherokee County School District", state: "GA", timeZone: "America/New_York" },
  { subdomain: "umass", name: "University of Massachusetts", state: "MA", timeZone: "America/New_York" },
  { subdomain: "transitchicago", name: "Chicago Transit Authority", state: "IL", timeZone: "America/Chicago" },
  { subdomain: "dart", name: "Dallas Area Rapid Transit", state: "TX", timeZone: "America/Chicago" },
  { subdomain: "dallasisd", name: "Dallas ISD", state: "TX", timeZone: "America/Chicago" },
  { subdomain: "dfwairport", name: "DFW International Airport", state: "TX", timeZone: "America/Chicago" },
  { subdomain: "nisd", name: "Northside ISD", state: "TX", timeZone: "America/Chicago" },
  { subdomain: "lubbock", name: "Lubbock County", state: "TX", timeZone: "America/Chicago" },
  { subdomain: "siouxfalls", name: "City of Sioux Falls", state: "SD", timeZone: "America/Chicago" },
  { subdomain: "tempe-gov", name: "City of Tempe", state: "AZ", timeZone: "America/Phoenix" },
  { subdomain: "sedonaaz", name: "City of Sedona", state: "AZ", timeZone: "America/Phoenix" },
  { subdomain: "rrnm-gov", name: "City of Rio Rancho", state: "NM", timeZone: "America/Denver" },
  { subdomain: "ccsd", name: "Clark County School District", state: "NV", timeZone: "America/Los_Angeles" },
  { subdomain: "ventura", name: "County of Ventura", state: "CA", timeZone: "America/Los_Angeles" },
];

interface BonfireResponse {
  success: boolean | number;
  payload?: {
    projects?: Record<string, BonfireProject> | BonfireProject[];
    departments?: Record<string, { DepartmentName?: string }>;
  };
}

interface BonfireProject {
  ProjectID: string;
  ReferenceID?: string;
  ProjectName: string;
  DateClose?: string; // wall time in the portal's zone, "YYYY-MM-DD HH:mm:ss"
  DepartmentID?: string;
}

/** Convert a wall-clock time in an IANA zone to a UTC ISO string. */
export function zonedWallTimeToUtc(wall: string, timeZone: string): string | null {
  const m = wall.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  // Offset of the zone at that instant, via Intl (no tz library needed).
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(guess - (asIfUtc - guess)).toISOString();
}

export function bonfireToOpportunity(p: BonfireProject, portal: BonfirePortal, department: string | null): Opportunity {
  return {
    externalId: `bonfire:${portal.subdomain}:${p.ProjectID}`,
    source: "state_portal",
    noticeType: "solicitation",
    title: p.ProjectName.trim(),
    solicitationNumber: p.ReferenceID?.trim() || null,
    agency: portal.name,
    office: department,
    naicsCode: null,
    pscCode: null,
    // Federal set-aside rules (and the 52.219-14 limit) don't apply to
    // state/local bids; local small/DBE programs are noted in the documents.
    setAside: "none",
    setAsideLabel: "State/local (no federal set-aside)",
    postedDate: null,
    responseDeadline: p.DateClose ? zonedWallTimeToUtc(p.DateClose, portal.timeZone) : null,
    placeOfPerformance: { city: null, state: portal.state || null, zip: null, country: "USA" },
    pointsOfContact: [],
    description: null,
    url: `https://${portal.subdomain}.bonfirehub.com/opportunities/${p.ProjectID}`,
    attachmentUrls: [],
    estimatedValue: null,
    active: true,
  };
}

export async function fetchBonfirePortal(portal: BonfirePortal): Promise<Opportunity[]> {
  const data = await fetchJson<BonfireResponse>(
    `https://${portal.subdomain}.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData`,
    { retries: 1, timeoutMs: 20_000 }
  );
  const projects = data.payload?.projects ?? [];
  const list = Array.isArray(projects) ? projects : Object.values(projects);
  const departments = data.payload?.departments ?? {};
  return list.map((p) => bonfireToOpportunity(p, portal, (p.DepartmentID && departments[p.DepartmentID]?.DepartmentName) || null));
}

/** All configured portals; one failing portal never blocks the rest. */
export async function fetchAllBonfire(extraSubdomains: string[] = []): Promise<{ opportunities: Opportunity[]; failed: string[] }> {
  const known = new Set(BONFIRE_PORTALS.map((p) => p.subdomain));
  const portals = [
    ...BONFIRE_PORTALS,
    ...extraSubdomains
      .filter((s) => !known.has(s))
      .map((s) => ({ subdomain: s, name: s, state: "", timeZone: "America/New_York" })),
  ];
  const opportunities: Opportunity[] = [];
  const failed: string[] = [];
  for (let i = 0; i < portals.length; i += 6) {
    const results = await Promise.allSettled(portals.slice(i, i + 6).map((p) => fetchBonfirePortal(p)));
    results.forEach((r, j) => {
      if (r.status === "fulfilled") opportunities.push(...r.value);
      else failed.push(portals[i + j].subdomain);
    });
  }
  return { opportunities, failed };
}
