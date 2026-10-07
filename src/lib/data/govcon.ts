import type {
  GovconBidRow,
  GovconEventRow,
  GovconOpportunityRow,
  GovconQuoteRow,
  GovconRfqRow,
  GovconRunRow,
  GovconSubcontractorRow,
} from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGoalStatus } from "@/lib/govcon/goal-status";
import { mergeProfile } from "@/lib/govcon/profile";
import type { CompanyInfo } from "@/lib/govcon/templates";
import type { CompanyProfile } from "@/lib/govcon/types";

/**
 * Dashboard reads. Uses the service-role client because the /govcon routes
 * are gated by the dashboard password in src/proxy.ts (the app has no
 * Supabase sign-in UI); never call these from public pages.
 */
export const isGovconDbConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const OPP_LIST_COLUMNS =
  "id, title, agency, office, trade, score, recommendation, status, status_reason, response_deadline, pop_city, pop_state, set_aside, set_aside_label, notice_type, estimated_value, url, last_error, updated_at";

export type OpportunityListItem = Pick<
  GovconOpportunityRow,
  | "id" | "title" | "agency" | "office" | "trade" | "score" | "recommendation" | "status" | "status_reason"
  | "response_deadline" | "pop_city" | "pop_state" | "set_aside" | "set_aside_label" | "notice_type"
  | "estimated_value" | "url" | "last_error" | "updated_at"
>;

export async function getDashboard() {
  const db = createAdminClient();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const list = (statuses: GovconOpportunityRow["status"][], order: "score" | "response_deadline", limit = 50) =>
    db
      .from("govcon_opportunities")
      .select(OPP_LIST_COLUMNS)
      .in("status", statuses)
      .order(order, { ascending: order === "response_deadline" })
      .limit(limit);

  const [ready, inFlight, fresh, submitted, events, runs, settings, submittedCount, wonCount, callCount, needsDocs] = await Promise.all([
    list(["ready"], "response_deadline"),
    list(["sourcing", "awaiting_quotes"], "response_deadline"),
    db.from("govcon_opportunities").select(OPP_LIST_COLUMNS).eq("status", "new").gt("response_deadline", now.toISOString()).order("score", { ascending: false }).limit(50),
    list(["submitted", "won", "lost"], "response_deadline", 25),
    db.from("govcon_events").select("*").order("created_at", { ascending: false }).limit(30),
    db.from("govcon_runs").select("*").order("started_at", { ascending: false }).limit(10),
    db.from("govcon_settings").select("*").eq("id", 1).maybeSingle(),
    db.from("govcon_bids").select("id", { count: "exact", head: true }).gte("submitted_at", monthStart),
    db.from("govcon_opportunities").select("id", { count: "exact", head: true }).eq("status", "won"),
    db.from("govcon_rfqs").select("id", { count: "exact", head: true }).eq("channel", "call").eq("status", "queued"),
    list(["needs_docs"], "response_deadline"),
  ]);
  for (const r of [ready, inFlight, fresh, submitted, events, runs]) if (r.error) throw r.error;

  return {
    ready: (ready.data ?? []) as OpportunityListItem[],
    needsDocs: (needsDocs.data ?? []) as OpportunityListItem[],
    inFlight: (inFlight.data ?? []) as OpportunityListItem[],
    fresh: (fresh.data ?? []) as OpportunityListItem[],
    submitted: (submitted.data ?? []) as OpportunityListItem[],
    events: (events.data ?? []) as GovconEventRow[],
    runs: (runs.data ?? []) as GovconRunRow[],
    profile: mergeProfile((settings.data?.profile ?? null) as Partial<CompanyProfile> | null),
    submittedThisMonth: submittedCount.count ?? 0,
    won: wonCount.count ?? 0,
    callList: callCount.count ?? 0,
  };
}

export interface RfqWithSub extends GovconRfqRow {
  sub: GovconSubcontractorRow | null;
  quote: GovconQuoteRow | null;
}

export async function getOpportunityDetail(id: string) {
  const db = createAdminClient();
  const { data: opp, error } = await db.from("govcon_opportunities").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!opp) return null;
  const [rfqs, quotes, bid, events] = await Promise.all([
    db.from("govcon_rfqs").select("*").eq("opportunity_id", id).order("created_at"),
    db.from("govcon_quotes").select("*").eq("opportunity_id", id).order("amount"),
    db.from("govcon_bids").select("*").eq("opportunity_id", id).maybeSingle(),
    db.from("govcon_events").select("*").eq("opportunity_id", id).order("created_at", { ascending: false }).limit(50),
  ]);
  const subIds = [...new Set((rfqs.data ?? []).map((r) => r.subcontractor_id))];
  const { data: subs } = subIds.length
    ? await db.from("govcon_subcontractors").select("*").in("id", subIds)
    : { data: [] as GovconSubcontractorRow[] };
  const subById = new Map((subs ?? []).map((s) => [s.id, s]));
  const quoteByRfq = new Map((quotes.data ?? []).map((q) => [q.rfq_id, q]));
  return {
    opp,
    rfqs: (rfqs.data ?? []).map((r) => ({ ...r, sub: subById.get(r.subcontractor_id) ?? null, quote: quoteByRfq.get(r.id) ?? null })) as RfqWithSub[],
    quotes: (quotes.data ?? []) as GovconQuoteRow[],
    bid: (bid.data ?? null) as GovconBidRow | null,
    events: (events.data ?? []) as GovconEventRow[],
    subById,
  };
}

export async function getCallList() {
  const db = createAdminClient();
  const { data: rfqs, error } = await db
    .from("govcon_rfqs")
    .select("*")
    .eq("channel", "call")
    .eq("status", "queued")
    .gt("quote_due_at", new Date().toISOString())
    .order("quote_due_at")
    .limit(200);
  if (error) throw error;
  const subIds = [...new Set((rfqs ?? []).map((r) => r.subcontractor_id))];
  const oppIds = [...new Set((rfqs ?? []).map((r) => r.opportunity_id))];
  const [{ data: subs }, { data: opps }] = await Promise.all([
    subIds.length ? db.from("govcon_subcontractors").select("*").in("id", subIds) : Promise.resolve({ data: [] as GovconSubcontractorRow[] }),
    oppIds.length ? db.from("govcon_opportunities").select("*").in("id", oppIds) : Promise.resolve({ data: [] as GovconOpportunityRow[] }),
  ]);
  const subById = new Map((subs ?? []).map((s) => [s.id, s]));
  const oppById = new Map((opps ?? []).map((o) => [o.id, o]));
  return (rfqs ?? [])
    .map((r) => ({ rfq: r, sub: subById.get(r.subcontractor_id), opp: oppById.get(r.opportunity_id) }))
    .filter((x): x is { rfq: GovconRfqRow; sub: GovconSubcontractorRow; opp: GovconOpportunityRow } => Boolean(x.sub && x.opp));
}

export async function getSettings(): Promise<{ profile: CompanyProfile; company: Partial<CompanyInfo>; state: Record<string, unknown> }> {
  const db = createAdminClient();
  const { data } = await db.from("govcon_settings").select("*").eq("id", 1).maybeSingle();
  return {
    profile: mergeProfile((data?.profile ?? null) as Partial<CompanyProfile> | null),
    company: (data?.company ?? {}) as Partial<CompanyInfo>,
    state: (data?.state ?? {}) as Record<string, unknown>,
  };
}

/** Public quote portal lookup — only what a sub should see. */
export async function getQuotePortal(token: string) {
  const db = createAdminClient();
  const { data: rfq } = await db.from("govcon_rfqs").select("*").eq("token", token).maybeSingle();
  if (!rfq) return null;
  const [{ data: opp }, { data: sub }, { data: quote }, { data: settings }] = await Promise.all([
    db.from("govcon_opportunities").select("id, title, trade, pop_city, pop_state, pop_zip, analysis, subcontracting, status, response_deadline").eq("id", rfq.opportunity_id).single(),
    db.from("govcon_subcontractors").select("name, email, phone").eq("id", rfq.subcontractor_id).single(),
    db.from("govcon_quotes").select("amount, created_at").eq("rfq_id", rfq.id).maybeSingle(),
    db.from("govcon_settings").select("company, profile").eq("id", 1).maybeSingle(),
  ]);
  if (!opp) return null;
  if (!rfq.viewed_at) {
    await db.from("govcon_rfqs").update({ viewed_at: new Date().toISOString(), ...(rfq.status === "sent" ? { status: "viewed" as const } : {}) }).eq("id", rfq.id);
  }
  const company = (settings?.company ?? {}) as Partial<CompanyInfo>;
  const analysis = (opp.analysis ?? {}) as { subScopeOfWork?: string; scopeSummary?: string; periodOfPerformance?: { description?: string }; wageDetermination?: string | null; siteVisit?: { offered?: boolean; mandatory?: boolean; details?: string | null } };
  return {
    rfq,
    sub,
    existingQuote: quote,
    companyName: company.name ?? mergeProfile((settings?.profile ?? null) as Partial<CompanyProfile> | null).companyName,
    job: {
      title: opp.title,
      location: [opp.pop_city, opp.pop_state, opp.pop_zip].filter(Boolean).join(", "),
      scope: analysis.subScopeOfWork ?? analysis.scopeSummary ?? opp.title,
      period: analysis.periodOfPerformance?.description ?? null,
      wageDetermination: analysis.wageDetermination ?? null,
      siteVisit: analysis.siteVisit ?? null,
      requiresSmallBusiness: (opp.subcontracting as { status?: string })?.status === "similarly_situated_required",
      open: ["awaiting_quotes", "sourcing"].includes(opp.status) && (!rfq.quote_due_at || Date.parse(rfq.quote_due_at) > Date.now()),
    },
  };
}

export async function getGoal() {
  const db = createAdminClient();
  const { data } = await db.from("govcon_settings").select("profile").eq("id", 1).maybeSingle();
  return getGoalStatus(db, mergeProfile((data?.profile ?? null) as Partial<CompanyProfile> | null));
}

export async function listContracts() {
  const db = createAdminClient();
  const { data: contracts, error } = await db.from("govcon_contracts").select("*").order("start_date", { ascending: false });
  if (error) throw error;
  const oppIds = (contracts ?? []).map((c) => c.opportunity_id);
  const { data: opps } = oppIds.length
    ? await db.from("govcon_opportunities").select("id, title, agency, pop_city, pop_state").in("id", oppIds)
    : { data: [] as Array<Pick<GovconOpportunityRow, "id" | "title" | "agency" | "pop_city" | "pop_state">> };
  const byId = new Map((opps ?? []).map((o) => [o.id, o]));
  return (contracts ?? []).map((c) => ({ ...c, opp: byId.get(c.opportunity_id) ?? null }));
}
