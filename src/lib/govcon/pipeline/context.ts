import { createAdminClient } from "@/lib/supabase/admin";
import type { GovconOpportunityRow } from "@/lib/supabase/database.types";

import { getGoalStatus } from "../goal-status";
import { mergeProfile } from "../profile";
import type { OpportunityScore, SubcontractingAssessment } from "../types";
import type { CompanyInfo } from "../templates";
import type { CompanyProfile, Opportunity } from "../types";

export type Db = ReturnType<typeof createAdminClient>;

export interface PipelineContext {
  db: Db;
  profile: CompanyProfile;
  company: CompanyInfo;
  settingsState: Record<string, unknown>;
  appUrl: string;
  keys: { sam: string | null; places: string | null };
  now: Date;
  /** Wall-clock deadline for this invocation (serverless time limit). */
  deadline: number;
}

export function timeLeft(ctx: PipelineContext): number {
  return ctx.deadline - Date.now();
}

export function appUrl(): string {
  const explicit = process.env.GOVCON_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export async function createContext(budgetMs: number): Promise<PipelineContext> {
  const db = createAdminClient();
  const { data: settings } = await db.from("govcon_settings").select("*").eq("id", 1).maybeSingle();
  const company = (settings?.company ?? {}) as Partial<CompanyInfo>;
  const baseProfile = mergeProfile(settings?.profile ?? null);
  // Auto-scale: the revenue goal sets how many proposals (and AI reads) we need.
  let profile = baseProfile;
  if (baseProfile.autoScale) {
    const goal = await getGoalStatus(db, baseProfile).catch(() => null);
    if (goal) {
      profile = { ...baseProfile, monthlyProposalTarget: goal.effectiveProposalTarget, maxAnalysesPerDay: goal.effectiveAnalysesPerDay };
    }
  }
  return {
    db,
    profile,
    company: {
      name: company.name ?? profile.companyName,
      uei: company.uei ?? process.env.GOVCON_UEI ?? null,
      cage: company.cage ?? process.env.GOVCON_CAGE ?? null,
      address: company.address ?? null,
      contactName: company.contactName ?? process.env.GOVCON_CONTACT_NAME ?? null,
      email: company.email ?? process.env.GOVCON_OWNER_EMAIL ?? null,
      phone: company.phone ?? process.env.GOVCON_PHONE ?? null,
    },
    settingsState: (settings?.state ?? {}) as Record<string, unknown>,
    appUrl: appUrl(),
    keys: { sam: process.env.SAM_API_KEY ?? null, places: process.env.GOOGLE_PLACES_API_KEY ?? null },
    now: new Date(),
    deadline: Date.now() + budgetMs,
  };
}

export async function saveSettingsState(ctx: PipelineContext, patch: Record<string, unknown>) {
  ctx.settingsState = { ...ctx.settingsState, ...patch };
  await ctx.db.from("govcon_settings").update({ state: ctx.settingsState }).eq("id", 1);
}

export async function logEvent(
  ctx: PipelineContext,
  opportunityId: string | null,
  kind: string,
  message: string,
  data?: unknown
) {
  await ctx.db.from("govcon_events").insert({ opportunity_id: opportunityId, kind, message, data: data ?? null });
}

export function oppToRow(
  opp: Opportunity,
  key: string,
  score: OpportunityScore & { subcontracting: SubcontractingAssessment }
): Partial<GovconOpportunityRow> & Pick<GovconOpportunityRow, "opportunity_key" | "notice_id" | "source" | "notice_type" | "title"> {
  return {
    opportunity_key: key,
    notice_id: opp.externalId,
    source: opp.source,
    notice_type: opp.noticeType,
    title: opp.title,
    solicitation_number: opp.solicitationNumber,
    agency: opp.agency,
    office: opp.office,
    naics_code: opp.naicsCode,
    psc_code: opp.pscCode,
    set_aside: opp.setAside,
    set_aside_label: opp.setAsideLabel,
    posted_date: opp.postedDate,
    response_deadline: opp.responseDeadline,
    pop_city: opp.placeOfPerformance.city ?? null,
    pop_state: opp.placeOfPerformance.state ?? null,
    pop_zip: opp.placeOfPerformance.zip ?? null,
    pop_country: opp.placeOfPerformance.country ?? null,
    points_of_contact: opp.pointsOfContact,
    description: opp.description?.slice(0, 100_000) ?? null,
    url: opp.url,
    estimated_value: opp.estimatedValue,
    trade: score.trade,
    score: score.total,
    recommendation: score.recommendation,
    score_detail: { factors: score.factors, disqualifiers: score.disqualifiers, flags: score.flags },
    subcontracting: score.subcontracting,
    priority: score.total, // refined by the estimate stage once a price anchor is known
  };
}

export function rowToOpp(row: GovconOpportunityRow): Opportunity {
  return {
    externalId: row.notice_id,
    source: row.source as Opportunity["source"],
    noticeType: row.notice_type as Opportunity["noticeType"],
    title: row.title,
    solicitationNumber: row.solicitation_number,
    agency: row.agency,
    office: row.office,
    naicsCode: row.naics_code,
    pscCode: row.psc_code,
    setAside: row.set_aside as Opportunity["setAside"],
    setAsideLabel: row.set_aside_label,
    postedDate: row.posted_date,
    responseDeadline: row.response_deadline,
    placeOfPerformance: { city: row.pop_city, state: row.pop_state, zip: row.pop_zip, country: row.pop_country },
    pointsOfContact: (row.points_of_contact ?? []) as Opportunity["pointsOfContact"],
    description: row.description,
    url: row.url,
    attachmentUrls: [],
    estimatedValue: row.estimated_value,
    active: true,
  };
}
