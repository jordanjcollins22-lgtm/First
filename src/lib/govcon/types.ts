/**
 * Govcon domain types. The business model ("win it, sub it out"):
 * we bid as the PRIME on government solicitations, line up a local
 * subcontractor near the place of performance to do the physical work,
 * and price our bid at the sub's quote plus a margin.
 *
 * Every source (SAM.gov API, SAM.gov bulk CSV, state portals) normalizes
 * into `Opportunity` so scoring and the pipeline never care where a
 * solicitation came from.
 */

export type OpportunitySource = "sam_api" | "sam_csv" | "state_portal";

/** SAM.gov notice types we act on. Solicitations are biddable; sources
 * sought / presolicitations are tracked as early warnings. */
export type NoticeType =
  | "solicitation"
  | "combined_synopsis_solicitation"
  | "presolicitation"
  | "sources_sought"
  | "special_notice"
  | "award"
  | "other";

/** Normalized set-aside buckets (SAM uses many codes for the same thing). */
export type SetAside =
  | "none" // full & open / unrestricted
  | "small_business" // total or partial SB set-aside (SBA, SBP)
  | "8a"
  | "hubzone"
  | "sdvosb"
  | "vosb"
  | "wosb"
  | "edwosb"
  | "other";

export interface PlaceOfPerformance {
  city?: string | null;
  state?: string | null; // 2-letter
  zip?: string | null;
  country?: string | null;
}

export interface PointOfContact {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  type?: string | null; // "primary" | "secondary"
}

export interface Opportunity {
  /** Stable id: SAM noticeId, or `${portal}:${id}` for state portals. */
  externalId: string;
  source: OpportunitySource;
  noticeType: NoticeType;
  title: string;
  solicitationNumber: string | null;
  agency: string | null;
  office: string | null;
  naicsCode: string | null;
  pscCode: string | null;
  setAside: SetAside;
  /** Raw set-aside label as published, for display. */
  setAsideLabel: string | null;
  postedDate: string | null; // ISO date
  responseDeadline: string | null; // ISO datetime (with offset when known)
  placeOfPerformance: PlaceOfPerformance;
  pointsOfContact: PointOfContact[];
  description: string | null; // text or a URL to fetch the description
  url: string | null; // human link (sam.gov/opp/...)
  attachmentUrls: string[];
  /** Award amount when the notice publishes one / estimated value if known. */
  estimatedValue: number | null;
  active: boolean;
}

export type TradeKey =
  | "landscaping"
  | "janitorial"
  | "pressure_washing"
  | "snow_removal"
  | "pest_control"
  | "hvac"
  | "plumbing"
  | "electrical"
  | "painting"
  | "roofing"
  | "flooring"
  | "doors_windows"
  | "fencing"
  | "paving_concrete"
  | "tree_service"
  | "waste_hauling"
  | "moving"
  | "window_cleaning"
  | "carpet_cleaning"
  | "general_repair";

export interface TradeDefinition {
  key: TradeKey;
  label: string;
  /** Search phrase used to find local subs ("HVAC repair near ..."). */
  subSearchQuery: string;
  naicsCodes: string[];
  pscPrefixes: string[];
  keywords: string[];
  /** 0-1: how easy it is to find a reliable local sub and price from a quote. */
  subcontractability: number;
}

export interface CompanyProfile {
  companyName: string;
  /** Our own small-business statuses — these decide which set-asides we can bid. */
  certifications: SetAside[];
  /** Trades we're willing to broker. Empty = all trades in the taxonomy. */
  trades: TradeKey[];
  /** 2-letter states to bid in. Empty = every state. */
  states: string[];
  /** Target markup over the winning sub quote, e.g. 0.25 = 25%. */
  targetMarkup: number;
  minMarkup: number;
  /** Skip anything due sooner than this — we need time to get sub quotes. */
  minDaysToRespond: number;
  /** Skip anything whose estimated value is above this (bonding/cash-flow risk). */
  maxEstimatedValue: number;
  /** Monthly proposal-volume target (the "20-25 a month" rule). */
  monthlyProposalTarget: number;
  /** Cap on solicitations read by AI per day (cost control, ~$0.25-1 each). */
  maxAnalysesPerDay: number;
  /** Revenue goal from this channel, per month. */
  monthlyRevenueTarget: number;
  /** Derive proposal target + daily analysis budget from the revenue goal. */
  autoScale: boolean;
  /** Hard ceiling on daily AI reads when autoScale is on (cost guard). */
  maxAnalysesPerDayCeiling: number;
  /** Extra Bonfire portal subdomains to watch (state/local bids). */
  bonfirePortals: string[];
}

export type BidRecommendation = "bid" | "maybe" | "no_bid";

export interface ScoreFactor {
  key: string;
  label: string;
  points: number;
  max: number;
  note?: string;
}

export interface OpportunityScore {
  total: number; // 0-100
  recommendation: BidRecommendation;
  trade: TradeKey | null;
  factors: ScoreFactor[];
  /** Hard disqualifiers — any one forces no_bid. */
  disqualifiers: string[];
  /** Soft warnings a human should read before submitting. */
  flags: string[];
}

export type SubOutStatus =
  | "unrestricted" // no limitation on subcontracting
  | "similarly_situated_required" // OK to sub out if the sub has our status
  | "ineligible"; // we can't bid this set-aside at all

export interface SubcontractingAssessment {
  status: SubOutStatus;
  /** Max share of the award amount we may pay to subs that are NOT similarly situated. */
  maxShareToNonSimilarlySituated: number;
  /** What a sub must be for 100% pass-through to stay compliant. */
  requiredSubStatus: SetAside | null;
  explanation: string;
}
