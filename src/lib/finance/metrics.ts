/**
 * The owner's finance numbers against the report's planning bands
 * (Landscaping four department playbook, "KPI targets"). Those bands come
 * mostly from vendors and are starting points, not standards, so each one
 * says where it came from and the owner can move it.
 */

export type Tone = "good" | "warn" | "bad" | "none";

export interface Band {
  /** Shown next to the number: "5–10%". */
  label: string;
  /** Where the band comes from. */
  source: string;
  /** Green when inside [goodMin, goodMax]; yellow when inside [warnMin, warnMax]; red otherwise. */
  goodMin?: number;
  goodMax?: number;
  warnMin?: number;
  warnMax?: number;
}

export function toneFor(value: number | null | undefined, band: Band): Tone {
  if (value === null || value === undefined || !Number.isFinite(value)) return "none";
  const inside = (min?: number, max?: number) => (min === undefined || value >= min) && (max === undefined || value <= max);
  if (inside(band.goodMin, band.goodMax)) return "good";
  if ((band.warnMin !== undefined || band.warnMax !== undefined) && inside(band.warnMin, band.warnMax)) return "warn";
  return "bad";
}

export const BANDS = {
  marketingPct: { label: "5–10%", source: "Agency synthesis (Webtonic), under $2M revenue", goodMin: 5, goodMax: 10, warnMin: 2, warnMax: 15 },
  laborPct: { label: "25–35% (warning over 40%)", source: "Vendor (Service Autopilot, FieldProxy)", goodMax: 35, warnMax: 40 },
  netMarginPct: { label: "10–15%+", source: "Conflicting sources (2–6% to 15–25%)", goodMin: 10, warnMin: 5 },
  grossCompany: { label: "30–60% depending on the mix", source: "FieldProxy; Snapshot Design", goodMin: 35, warnMin: 25 },
  grossMaintenance: { label: "~50%", source: "Level CFO planning band (unverified)", goodMin: 45, warnMin: 40 },
  grossInstall: { label: "22–28%", source: "Level CFO planning band (unverified)", goodMin: 22, warnMin: 18 },
  grossSnow: { label: "20–28%", source: "Level CFO planning band (unverified)", goodMin: 20, warnMin: 15 },
  dso: { label: "Under 30 days", source: "Owner target; no landscaping DSO benchmark found", goodMax: 30, warnMax: 45 },
  over30Pct: { label: "Trending down", source: "No benchmark; internal", goodMax: 10, warnMax: 25 },
  autopayPct: { label: "≥ 80% of recurring", source: "Internal target", goodMin: 80, warnMin: 50 },
  closeRatePct: { label: "40–60%", source: "Level CFO (unverified); over 70% means test price", goodMin: 40, goodMax: 70, warnMin: 30 },
  revPerHour: { label: "$65–$145 per crew hour", source: "Blogs (Beancount)", goodMin: 65, warnMin: 50 },
  finalHoursPct: { label: "100% of finished jobs", source: "Internal", goodMin: 95, warnMin: 70 },
} satisfies Record<string, Band>;

export type BandKey = keyof typeof BANDS;

/** The DSO band with the owner's own target in place of 30 days. */
export function dsoBand(targetDays: number): Band {
  return { ...BANDS.dso, label: `Under ${targetDays} days`, goodMax: targetDays, warnMax: Math.round(targetDays * 1.5) };
}

export type Division = "Maintenance" | "Install" | "Snow & ice";
export const DIVISIONS: Division[] = ["Maintenance", "Install", "Snow & ice"];

export const DIVISION_BAND: Record<Division, Band> = {
  Maintenance: BANDS.grossMaintenance,
  Install: BANDS.grossInstall,
  "Snow & ice": BANDS.grossSnow,
};

const SNOW = /\b(snow|salt|ice|plow|plough|de-?ic)/i;
const MAINTENANCE = /\b(mow|mowing|lawn|maint|trim|edg|weed|leaf|leaves|clean ?up|fertili|aerat|overseed|prun|hedge|shrub|mulch)/i;

/**
 * Which division a job belongs to, from its services' names. Snow wins over
 * maintenance (a "salt walkway" job is snow work), and anything that names
 * neither is install: patios, plantings, grading, drainage.
 */
export function divisionOf(serviceNames: string[], pipeline?: string | null): Division {
  if (pipeline === "quick_mow") return "Maintenance";
  const text = serviceNames.join(" ");
  if (SNOW.test(text)) return "Snow & ice";
  if (MAINTENANCE.test(text)) return "Maintenance";
  return "Install";
}

export interface CostedJob {
  division: Division;
  price: number;
  labour: number;
  materials: number;
  other: number;
}

export interface DivisionMargin {
  division: Division;
  jobs: number;
  revenue: number;
  grossProfit: number;
  /** Percent, or null with no costed jobs. */
  marginPct: number | null;
  tone: Tone;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function marginsByDivision(jobs: CostedJob[]): DivisionMargin[] {
  return DIVISIONS.map((division) => {
    const mine = jobs.filter((j) => j.division === division && j.price > 0);
    const revenue = mine.reduce((s, j) => s + j.price, 0);
    const grossProfit = mine.reduce((s, j) => s + j.price - j.labour - j.materials - j.other, 0);
    const marginPct = revenue > 0 ? r1((grossProfit / revenue) * 100) : null;
    return { division, jobs: mine.length, revenue, grossProfit, marginPct, tone: toneFor(marginPct, DIVISION_BAND[division]) };
  });
}

/**
 * A number against its own recent average: green at or above it, yellow
 * within a quarter below, red further down. No history is no judgement.
 */
export function trendTone(value: number, baseline: number): Tone {
  if (!(baseline > 0)) return "none";
  if (value >= baseline) return "good";
  if (value >= baseline * 0.75) return "warn";
  return "bad";
}

/** A share as a percent to one decimal, or null when the whole is nothing. */
export function pct(part: number, whole: number): number | null {
  return whole > 0 ? r1((part / whole) * 100) : null;
}

const MARKETING = /(facebook|\bmeta\b|fb\.me|google\s*\*?ads|google ads|adwords|instagram|nextdoor|yelp|\bangi\b|homeadvisor|thumbtack|vistaprint|eddm|every door|gohighlevel|highlevel|mailchimp|door ?hang|\bsigns?\b|printing|print shop|bark\.com)/i;

/** Whether a bank charge is marketing spend, from who it went to. */
export function isMarketingCharge(who: string | null | undefined): boolean {
  return Boolean(who && MARKETING.test(who));
}

const NOT_EXPENSE = new Set(["TRANSFER_OUT", "TRANSFER_IN", "LOAN_PAYMENTS", "INCOME"]);

/** Whether a bank outflow is an operating expense rather than moving money between accounts or paying down a loan. */
export function isOperatingExpense(category: string | null | undefined): boolean {
  return !category || !NOT_EXPENSE.has(category);
}

export interface ScorecardMetric {
  key: string;
  label: string;
  value: string;
  tone: Tone;
  target: string;
  /** Who answers for it in the weekly review. */
  owner: string;
  note?: string;
}
