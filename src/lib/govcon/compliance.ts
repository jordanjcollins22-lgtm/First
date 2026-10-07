import type { SetAside, SubcontractingAssessment } from "./types";

/**
 * Limitations on Subcontracting (FAR 52.219-14 / 13 CFR 125.6) — the rule
 * that makes or breaks the "win it, sub it out" model, encoded so the
 * pipeline never queues a bid we can't legally perform.
 *
 * - Small business set-asides above the simplified acquisition threshold
 *   (SAT), and 8(a)/HUBZone/SDVOSB/WOSB set-asides at any value, carry the
 *   limit: for services the prime may pay at most 50% of the award amount
 *   to subs that are NOT "similarly situated" (special-trade construction
 *   75%, general construction 85%).
 * - A similarly situated sub (same small-business program status as us AND
 *   small under the NAICS code we assign to the subcontract) counts as us —
 *   so 100% pass-through is compliant only if every sub qualifies and does
 *   not itself sub the work further.
 * - Unrestricted (full & open) awards have no limit.
 * - Small business set-asides at or below the SAT are outside 13 CFR 125.6,
 *   but a contracting officer can still include 52.219-14 — so when the
 *   solicitation text shows the clause, it wins.
 *
 * This is a screening tool, not legal advice; the bid checklist tells the
 * user to confirm the clause in Section I of the actual solicitation.
 */

/** FAR 2.101 simplified acquisition threshold (raised to $350k on 2025-10-01). */
export const SIMPLIFIED_ACQUISITION_THRESHOLD = 350_000;

export type WorkCategory =
  | "services"
  | "supplies"
  | "general_construction"
  | "specialty_construction";

export function workCategoryForNaics(naics: string | null | undefined): WorkCategory {
  if (!naics) return "services";
  if (naics.startsWith("2361") || naics.startsWith("2362") || naics.startsWith("237")) {
    return "general_construction";
  }
  if (naics.startsWith("238")) return "specialty_construction";
  if (/^3[1-3]/.test(naics) || naics.startsWith("42")) return "supplies";
  return "services";
}

/** Share of the award the prime may pay to non-similarly-situated subs. */
export const LOS_CAP: Record<WorkCategory, number> = {
  services: 0.5,
  supplies: 0.5, // measured against cost of manufacturing; nonmanufacturer rule applies
  general_construction: 0.85,
  specialty_construction: 0.75,
};

const PROGRAM_SET_ASIDES: SetAside[] = ["8a", "hubzone", "sdvosb", "vosb", "wosb", "edwosb"];

/** Which of our certifications let us bid a given set-aside. */
export function canBidSetAside(setAside: SetAside, ourCerts: SetAside[]): boolean {
  if (setAside === "none") return true;
  if (setAside === "other") return false;
  // Every program certification also makes us a small business.
  const isSmall = ourCerts.length > 0;
  if (setAside === "small_business") return isSmall;
  if (setAside === "vosb") return ourCerts.includes("vosb") || ourCerts.includes("sdvosb");
  if (setAside === "wosb") return ourCerts.includes("wosb") || ourCerts.includes("edwosb");
  return ourCerts.includes(setAside);
}

export function assessSubcontracting(input: {
  setAside: SetAside;
  naicsCode: string | null;
  estimatedValue: number | null;
  ourCerts: SetAside[];
  /** true/false once the solicitation text has been checked for 52.219-14; null = unknown. */
  losClausePresent?: boolean | null;
}): SubcontractingAssessment {
  const { setAside, naicsCode, estimatedValue, ourCerts } = input;
  const clause = input.losClausePresent ?? null;
  const category = workCategoryForNaics(naicsCode);
  const cap = LOS_CAP[category];

  if (!canBidSetAside(setAside, ourCerts)) {
    return {
      status: "ineligible",
      maxShareToNonSimilarlySituated: 0,
      requiredSubStatus: null,
      explanation: `Set aside for ${setAside} — we don't hold that status, so we can't bid as prime.`,
    };
  }

  if (setAside === "none") {
    return {
      status: "unrestricted",
      maxShareToNonSimilarlySituated: 1,
      requiredSubStatus: null,
      explanation:
        "Unrestricted (full & open): no limitation on subcontracting. Expect more competition, including large firms.",
    };
  }

  const pct = `${Math.round(cap * 100)}%`;

  if (PROGRAM_SET_ASIDES.includes(setAside)) {
    return {
      status: "similarly_situated_required",
      maxShareToNonSimilarlySituated: cap,
      requiredSubStatus: setAside,
      explanation: `${setAside.toUpperCase()} set-aside: at most ${pct} of the award may go to subs without ${setAside.toUpperCase()} status. Full pass-through only to ${setAside.toUpperCase()} subs that are small under NAICS ${naicsCode ?? "(assigned)"}.`,
    };
  }

  // Total/partial small business set-aside.
  const underSat = estimatedValue !== null && estimatedValue <= SIMPLIFIED_ACQUISITION_THRESHOLD;
  if (clause === false || (clause === null && underSat)) {
    return {
      status: "unrestricted",
      maxShareToNonSimilarlySituated: 1,
      requiredSubStatus: null,
      explanation:
        clause === false
          ? "Small business set-aside with no 52.219-14 clause in the solicitation: no limitation on subcontracting."
          : `Small business set-aside at or under the $${SIMPLIFIED_ACQUISITION_THRESHOLD.toLocaleString()} SAT: limitation on subcontracting normally doesn't apply. Confirm FAR 52.219-14 isn't in Section I.`,
    };
  }

  return {
    status: "similarly_situated_required",
    maxShareToNonSimilarlySituated: cap,
    requiredSubStatus: "small_business",
    explanation: `Small business set-aside${clause ? " with FAR 52.219-14" : estimatedValue === null ? " of unknown value (assume 52.219-14 applies)" : " above the SAT"}: at most ${pct} may go to subs that aren't small under NAICS ${naicsCode ?? "(assigned)"}. Use small-business subs (and have them certify size) to pass through 100%.`,
  };
}

/** Check a planned subcontract against the assessment. */
export function checkSubcontractPlan(input: {
  assessment: SubcontractingAssessment;
  awardAmount: number;
  subAmount: number;
  subIsSimilarlySituated: boolean;
}): { compliant: boolean; message: string } {
  const { assessment, awardAmount, subAmount, subIsSimilarlySituated } = input;
  if (assessment.status === "unrestricted" || subIsSimilarlySituated) {
    return { compliant: true, message: "Subcontract is within limits." };
  }
  if (assessment.status === "ineligible") {
    return { compliant: false, message: assessment.explanation };
  }
  const share = awardAmount > 0 ? subAmount / awardAmount : 1;
  const cap = assessment.maxShareToNonSimilarlySituated;
  return share <= cap
    ? { compliant: true, message: `Sub share ${(share * 100).toFixed(0)}% is within the ${(cap * 100).toFixed(0)}% cap.` }
    : {
        compliant: false,
        message: `Sub share ${(share * 100).toFixed(0)}% exceeds the ${(cap * 100).toFixed(0)}% cap for subs that aren't similarly situated. Use a ${assessment.requiredSubStatus ?? "similarly situated"} sub.`,
      };
}
