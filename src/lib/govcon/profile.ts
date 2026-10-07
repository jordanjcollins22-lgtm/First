import type { CompanyProfile } from "./types";

/**
 * Default company profile so the pipeline runs with zero setup. A row in
 * `govcon_settings` (edited at /govcon/settings) overrides any field.
 */
export const DEFAULT_PROFILE: CompanyProfile = {
  companyName: process.env.GOVCON_COMPANY_NAME ?? "Our Company LLC",
  // A new LLC with no program certifications is still a small business,
  // which unlocks total small business set-asides (the bulk of the volume).
  certifications: ["small_business"],
  trades: [],
  states: [],
  targetMarkup: 0.25,
  minMarkup: 0.12,
  minDaysToRespond: 5,
  maxEstimatedValue: 1_500_000,
  monthlyProposalTarget: 25,
  // ~25 proposals/month needs a few analyses a day once no-bids drop out.
  maxAnalysesPerDay: 8,
};

export function mergeProfile(overrides: Partial<CompanyProfile> | null | undefined): CompanyProfile {
  if (!overrides) return DEFAULT_PROFILE;
  const merged = { ...DEFAULT_PROFILE };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== null && v !== undefined) (merged as Record<string, unknown>)[k] = v;
  }
  return merged;
}
