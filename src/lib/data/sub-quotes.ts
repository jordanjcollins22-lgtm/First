import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { outboundBaseUrl } from "@/lib/base-url";
import { isQuoteToken, withoutZoneTalk, type QuoteArea, type SubQuoteStatus } from "@/lib/sub-quotes";

export interface SubQuoteRequestRow {
  id: string;
  token: string;
  serviceLabel: string;
  areas: QuoteArea[];
  status: SubQuoteStatus;
  contractorName: string | null;
  contractorPhone: string | null;
  contractorEmail: string | null;
  quoteAmount: number | null;
  quoteNote: string | null;
  quotedAt: string | null;
  createdAt: string;
  /** Ready to paste into a text to the contractor. */
  link: string;
}

export function quoteLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/quote/${token}`;
}

/** Every price request on a job, newest first. */
export async function listSubQuoteRequests(jobId: string): Promise<SubQuoteRequestRow[]> {
  const supabase = await createClient();
  const [{ data }, baseUrl] = await Promise.all([
    supabase.from("sub_quote_requests").select("*").eq("job_id", jobId).order("created_at", { ascending: false }),
    outboundBaseUrl(),
  ]);
  return ((data ?? []) as {
    id: string;
    token: string;
    service_label: string;
    areas: unknown;
    status: string;
    contractor_name: string | null;
    contractor_phone: string | null;
    contractor_email: string | null;
    quote_amount: number | string | null;
    quote_note: string | null;
    quoted_at: string | null;
    created_at: string;
  }[]).map((row) => ({
    id: row.id,
    token: row.token,
    serviceLabel: row.service_label,
    areas: (Array.isArray(row.areas) ? row.areas : []) as QuoteArea[],
    status: row.status as SubQuoteStatus,
    contractorName: row.contractor_name,
    contractorPhone: row.contractor_phone,
    contractorEmail: row.contractor_email,
    quoteAmount: row.quote_amount == null ? null : Number(row.quote_amount),
    quoteNote: row.quote_note,
    quotedAt: row.quoted_at,
    createdAt: row.created_at,
    link: quoteLink(baseUrl, row.token),
  }));
}

/** What the contractor's page shows. No client name, no other areas, no zones. */
export interface PublicSubQuote {
  token: string;
  businessName: string;
  businessPhone: string | null;
  /** Where the work is. A contractor has to be able to find it. */
  address: string | null;
  serviceLabel: string;
  areas: QuoteArea[];
  note: string | null;
  status: SubQuoteStatus;
  contractorName: string | null;
  quoteAmount: number | null;
  quoteNote: string | null;
  quotedAt: string | null;
}

/**
 * The request behind a token, for somebody with no account.
 *
 * Service role, because the reader is a contractor on their own phone. The
 * token is the whole of the authorisation, so the page carries only what
 * that contractor needs to price the work.
 */
export async function getSubQuoteByToken(token: string): Promise<PublicSubQuote | null> {
  if (!isQuoteToken(token)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("sub_quote_requests")
    .select("token, service_label, areas, note, status, contractor_name, quote_amount, quote_note, quoted_at, organization:organizations(name, business_phone), job:jobs(property:properties(address))")
    .eq("token", token)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as {
    token: string;
    service_label: string;
    areas: unknown;
    note: string | null;
    status: string;
    contractor_name: string | null;
    quote_amount: number | string | null;
    quote_note: string | null;
    quoted_at: string | null;
    organization: { name: string; business_phone: string | null } | null;
    job: { property: { address: string } | null } | null;
  };
  const areas = (Array.isArray(row.areas) ? row.areas : []) as QuoteArea[];
  return {
    token: row.token,
    businessName: row.organization?.name ?? "JS Landscaping",
    businessPhone: row.organization?.business_phone ?? null,
    address: row.job?.property?.address ?? null,
    serviceLabel: row.service_label,
    areas: areas.map((a) => ({ scopeText: withoutZoneTalk(a.scopeText ?? ""), photoPaths: a.photoPaths ?? [] })),
    note: row.note,
    status: row.status as SubQuoteStatus,
    contractorName: row.contractor_name,
    quoteAmount: row.quote_amount == null ? null : Number(row.quote_amount),
    quoteNote: row.quote_note,
    quotedAt: row.quoted_at,
  };
}
