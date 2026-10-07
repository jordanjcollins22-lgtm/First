import { assessSubcontracting } from "./compliance";
import { classifyTrade } from "./trades";
import type {
  CompanyProfile,
  Opportunity,
  OpportunityScore,
  ScoreFactor,
  SubcontractingAssessment,
} from "./types";

/**
 * Bid / no-bid scoring for the broker model. Deterministic and explainable:
 * every point is a named factor shown on the dashboard, and hard
 * disqualifiers (wrong set-aside, too little time, overseas, sole source)
 * force no_bid regardless of points.
 */

const MS_PER_DAY = 86_400_000;

/** Phrases that make brokering risky. Penalty points out of the 10-pt factor. */
const RED_FLAGS: Array<{ pattern: RegExp; label: string; penalty: number; disqualify?: boolean }> = [
  { pattern: /security clearance|secret clearance|top secret|\bts\/sci\b/i, label: "Security clearance required", penalty: 10, disqualify: true },
  { pattern: /sole[- ]source|intent to (award|sole)|notice of intent/i, label: "Sole source / intent to award", penalty: 10, disqualify: true },
  { pattern: /\b(performance|payment|bid) bond/i, label: "Bonding required", penalty: 5 },
  { pattern: /mandatory (site visit|pre-?bid|pre-?proposal)/i, label: "Mandatory site visit — a sub must attend", penalty: 2 },
  { pattern: /key personnel|on-?site (project )?(manager|supervisor)|full-?time supervisor/i, label: "Key personnel / on-site supervisor", penalty: 3 },
  { pattern: /brand name or equal|brand-name/i, label: "Brand-name items (confirm sub can supply)", penalty: 1 },
  { pattern: /\bidiq\b|indefinite delivery|multiple award/i, label: "IDIQ / multiple-award vehicle", penalty: 2 },
  { pattern: /\b(blanket purchase agreement|bpa)\b/i, label: "BPA (orders not guaranteed)", penalty: 2 },
  { pattern: /abilityone|procurement list|javits-wagner-o'day/i, label: "AbilityOne mandatory source", penalty: 10, disqualify: true },
  { pattern: /background (check|investigation)|base access|dbids|\bcac\b|piv card/i, label: "Base access / background checks for crews", penalty: 2 },
  { pattern: /collective bargaining|\bcba\b|nondisplacement|non-displacement/i, label: "CBA wages / incumbent workforce rules", penalty: 2 },
  { pattern: /24\/7|24 hours a day|emergency (response|call)/i, label: "24/7 emergency response", penalty: 2 },
  // Mostly state/local titles, where there's no PSC code to catch these.
  { pattern: /\b(purchase of|supply of|supplies\b|furnish and deliver|asphalt (concrete )?mix|traffic paint|bulk (salt|mulch) purchase)/i, label: "Product purchase, not a service", penalty: 10, disqualify: true },
  { pattern: /pre-?qualified|prequalification required/i, label: "Restricted to prequalified contractors", penalty: 10, disqualify: true },
  { pattern: /\b(sbe|dbe|mbe|wbe|hub)\b.{0,15}(set-?aside|goal|requirement|participation)/i, label: "Local SBE/DBE certification or participation goal", penalty: 2 },
];

export function daysUntil(deadline: string | null, now: Date): number | null {
  if (!deadline) return null;
  const t = Date.parse(deadline);
  if (Number.isNaN(t)) return null;
  return (t - now.getTime()) / MS_PER_DAY;
}

export function scoreOpportunity(
  opp: Opportunity,
  profile: CompanyProfile,
  opts: { now?: Date; losClausePresent?: boolean | null } = {}
): OpportunityScore & { subcontracting: SubcontractingAssessment } {
  const now = opts.now ?? new Date();
  const factors: ScoreFactor[] = [];
  const disqualifiers: string[] = [];
  const flags: string[] = [];

  // --- Trade fit (25) -------------------------------------------------------
  const match = classifyTrade({
    title: opp.title,
    naicsCode: opp.naicsCode,
    pscCode: opp.pscCode,
    description: opp.description,
    allowed: profile.trades,
  });
  if (!match) {
    disqualifiers.push("Not a trade we can broker to a local sub");
    factors.push({ key: "trade", label: "Trade fit", points: 0, max: 25 });
  } else {
    const confidence = match.via.includes("title") || match.via.includes("naics") ? 1 : 0.7;
    factors.push({
      key: "trade",
      label: "Trade fit",
      points: Math.round(25 * match.trade.subcontractability * confidence),
      max: 25,
      note: `${match.trade.label} (matched on ${match.via.join(", ")})`,
    });
  }

  // --- Notice type (10) -----------------------------------------------------
  const biddable =
    opp.noticeType === "solicitation" || opp.noticeType === "combined_synopsis_solicitation";
  const earlyWarning = opp.noticeType === "presolicitation" || opp.noticeType === "sources_sought";
  if (!biddable && !earlyWarning) disqualifiers.push(`Notice type "${opp.noticeType}" is not biddable`);
  factors.push({
    key: "notice",
    label: "Notice type",
    points: biddable ? 10 : earlyWarning ? 4 : 0,
    max: 10,
    note: earlyWarning ? "Early notice — line up subs now, bid when the solicitation drops" : undefined,
  });

  // --- Response runway (15) -------------------------------------------------
  const days = daysUntil(opp.responseDeadline, now);
  let runwayPts = 6;
  let runwayNote = "No deadline published";
  if (days !== null) {
    runwayNote = `${Math.max(0, Math.floor(days))} days to respond`;
    if (days < 0) {
      disqualifiers.push("Response deadline has passed");
      runwayPts = 0;
    } else if (biddable && days < profile.minDaysToRespond) {
      disqualifiers.push(`Due in under ${profile.minDaysToRespond} days — not enough time to get sub quotes`);
      runwayPts = 0;
    } else if (days < 7) runwayPts = 7;
    else if (days < 14) runwayPts = 12;
    else runwayPts = 15;
  }
  factors.push({ key: "runway", label: "Time to respond", points: runwayPts, max: 15, note: runwayNote });

  // --- Set-aside & subcontracting limits (15) -------------------------------
  const subcontracting = assessSubcontracting({
    setAside: opp.setAside,
    naicsCode: opp.naicsCode,
    estimatedValue: opp.estimatedValue,
    ourCerts: profile.certifications,
    losClausePresent: opts.losClausePresent,
  });
  let setAsidePts = 0;
  if (subcontracting.status === "ineligible") {
    disqualifiers.push(subcontracting.explanation);
  } else if (subcontracting.status === "unrestricted") {
    // A set-aside we qualify for with no LoS is the sweet spot; full & open
    // is legal but brings large competitors.
    setAsidePts = opp.setAside === "none" ? 8 : 15;
  } else {
    setAsidePts = 10;
    flags.push(subcontracting.explanation);
  }
  factors.push({
    key: "set_aside",
    label: "Set-aside & sub-out rules",
    points: setAsidePts,
    max: 15,
    note: opp.setAsideLabel ?? (opp.setAside === "none" ? "Unrestricted" : opp.setAside),
  });

  // --- Value sweet spot (15) ------------------------------------------------
  const value = opp.estimatedValue;
  let valuePts = 8;
  let valueNote = "Value not published — price from sub quote + history";
  if (value !== null) {
    valueNote = `$${Math.round(value).toLocaleString()}`;
    if (value > profile.maxEstimatedValue) {
      disqualifiers.push(`Estimated value $${Math.round(value).toLocaleString()} exceeds our $${profile.maxEstimatedValue.toLocaleString()} limit`);
      valuePts = 0;
    } else if (value < 10_000) valuePts = 6;
    else if (value <= 350_000) valuePts = 15;
    else valuePts = 10;
  }
  factors.push({ key: "value", label: "Contract size", points: valuePts, max: 15, note: valueNote });

  // --- Location (10) --------------------------------------------------------
  const pop = opp.placeOfPerformance;
  let locationPts = 10;
  let locationNote = [pop.city, pop.state].filter(Boolean).join(", ") || "Location unknown";
  if (pop.country && !["USA", "US", "UNITED STATES"].includes(pop.country.toUpperCase())) {
    disqualifiers.push(`Performance outside the US (${pop.country})`);
    locationPts = 0;
  } else if (!pop.state) {
    locationPts = 6;
    locationNote = "Location not in notice — check the documents";
  } else if (profile.states.length && !profile.states.includes(pop.state.toUpperCase())) {
    disqualifiers.push(`${pop.state} is outside our target states`);
    locationPts = 0;
  }
  factors.push({ key: "location", label: "Location", points: locationPts, max: 10, note: locationNote });

  // --- Red flags (10) -------------------------------------------------------
  const haystack = `${opp.title}\n${opp.description ?? ""}`;
  let penalty = 0;
  for (const rf of RED_FLAGS) {
    if (rf.pattern.test(haystack)) {
      penalty += rf.penalty;
      if (rf.disqualify) disqualifiers.push(rf.label);
      else flags.push(rf.label);
    }
  }
  factors.push({ key: "risk", label: "Risk flags", points: Math.max(0, 10 - penalty), max: 10 });

  const total = Math.round(factors.reduce((s, f) => s + f.points, 0));
  let recommendation: OpportunityScore["recommendation"];
  if (disqualifiers.length) recommendation = "no_bid";
  else if (total >= 70 && biddable) recommendation = "bid";
  else if (total >= 50) recommendation = "maybe";
  else recommendation = "no_bid";

  return {
    total,
    recommendation,
    trade: match?.trade.key ?? null,
    factors,
    disqualifiers,
    flags,
    subcontracting,
  };
}
