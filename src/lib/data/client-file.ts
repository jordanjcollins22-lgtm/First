import { createClient } from "@/lib/supabase/server";
import { readAddons, type ProposalAddon } from "@/lib/proposal-addons";

/**
 * Everything the fresh app shows about one client: their jobs, and for each
 * job its proposal, invoices, messages and dates. One read per table, scoped
 * by row-level security like every other read in the app.
 */

export interface FileMessage {
  at: string;
  who: string;
  fromClient: boolean;
  body: string;
}

export interface FileJob {
  id: string;
  name: string;
  status: string;
  address: string;
  evaluationDate: string | null;
  evaluationStatus: string | null;
  startDate: string | null;
  endDate: string | null;
  completedAt: string | null;
  proposal: { token: string; status: string; total: number; sentAt: string | null; respondedAt: string | null; addons: ProposalAddon[] } | null;
  /** The free-estimate map's link for this job, and what it priced. */
  estimate: { token: string | null; total: number | null; deposit: number | null; paidAt: string | null; choice: string | null } | null;
  invoices: { id: string; amount: number; status: string; sentAt: string | null; paidAt: string | null; url: string | null }[];
  messages: FileMessage[];
}

export interface ClientFile {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  town: string;
  doNotContact: boolean;
  jobs: FileJob[];
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => Number(v) || 0;

/** "12 Main St, Bel Air, MD 21014" → "Bel Air". */
export function townOf(address: string): string {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length >= 3 ? parts[parts.length - 2] : parts[1] ?? "";
}

export async function loadClientFile(customerId: string): Promise<ClientFile | null> {
  const sb = await createClient();
  const { data: customer } = await sb.from("customers").select("id,name,phone,email,do_not_contact").eq("id", customerId).maybeSingle();
  if (!customer) return null;
  const c = customer as Row;

  const { data: props } = await sb.from("properties").select("id,address").eq("customer_id", customerId);
  const addressOf = new Map(((props ?? []) as Row[]).map((p) => [str(p.id), str(p.address)]));
  const propertyIds = [...addressOf.keys()];

  const { data: jobRows } = propertyIds.length
    ? await sb
        .from("jobs")
        .select("id,name,status,property_id,evaluation_date,evaluation_status,project_start_date,project_end_date,completed_at,created_at")
        .in("property_id", propertyIds)
        .order("created_at", { ascending: false })
    : { data: [] };
  const jobs = (jobRows ?? []) as Row[];
  const jobIds = jobs.map((j) => str(j.id));

  const [proposals, invoices, messages, intakes, estimates] = jobIds.length
    ? await Promise.all([
        sb.from("job_proposals").select("job_id,token,status,total_cost,discount_amount,sent_at,responded_at,options").in("job_id", jobIds),
        sb.from("invoices").select("id,job_id,amount,status,sent_at,paid_at,hosted_invoice_url,created_at").in("job_id", jobIds).order("created_at", { ascending: true }),
        sb.from("job_messages").select("job_id,body,author_name,author_type,created_at").in("job_id", jobIds).order("created_at", { ascending: false }).limit(200),
        sb.from("evaluation_intakes").select("job_id,token").in("job_id", jobIds),
        sb.from("job_estimates").select("job_id,total_cents,deposit_cents,paid_at,choice").in("job_id", jobIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const intakeBy = new Map(((intakes.data ?? []) as Row[]).map((r) => [str(r.job_id), str(r.token)]));
  const estimateBy = new Map(((estimates.data ?? []) as Row[]).map((r) => [str(r.job_id), r]));

  const proposalBy = new Map(((proposals.data ?? []) as Row[]).map((p) => [str(p.job_id), p]));
  const group = <T,>(rows: Row[], map: (r: Row) => T) => {
    const out = new Map<string, T[]>();
    for (const r of rows) out.set(str(r.job_id), [...(out.get(str(r.job_id)) ?? []), map(r)]);
    return out;
  };
  const invoicesBy = group((invoices.data ?? []) as Row[], (i) => ({
    id: str(i.id),
    amount: num(i.amount),
    status: str(i.status),
    sentAt: str(i.sent_at) || null,
    paidAt: str(i.paid_at) || null,
    url: str(i.hosted_invoice_url) || null,
  }));
  const messagesBy = group((messages.data ?? []) as Row[], (m) => ({
    at: str(m.created_at),
    who: str(m.author_name) || (m.author_type === "client" ? str(c.name) : "Us"),
    fromClient: m.author_type === "client",
    body: str(m.body),
  }));

  const firstAddress = addressOf.values().next().value ?? "";
  return {
    id: str(c.id),
    name: str(c.name) || "Client",
    phone: str(c.phone) || null,
    email: str(c.email) || null,
    town: townOf(firstAddress),
    doNotContact: Boolean(c.do_not_contact),
    jobs: jobs.map((j) => {
      const p = proposalBy.get(str(j.id));
      return {
        id: str(j.id),
        name: str(j.name) || "Project",
        status: str(j.status),
        address: addressOf.get(str(j.property_id)) ?? "",
        evaluationDate: str(j.evaluation_date) || null,
        evaluationStatus: str(j.evaluation_status) || null,
        startDate: str(j.project_start_date) || null,
        endDate: str(j.project_end_date) || null,
        completedAt: str(j.completed_at) || null,
        proposal: p
          ? {
              token: str(p.token),
              status: str(p.status),
              total: num(p.total_cost) - num(p.discount_amount),
              sentAt: str(p.sent_at) || null,
              respondedAt: str(p.responded_at) || null,
              addons: readAddons(p.options),
            }
          : null,
        estimate: (() => {
          const token = intakeBy.get(str(j.id)) || null;
          const e = estimateBy.get(str(j.id));
          if (!token && !e) return null;
          return {
            token,
            total: e ? num(e.total_cents) / 100 : null,
            deposit: e ? num(e.deposit_cents) / 100 : null,
            paidAt: e ? str(e.paid_at) || null : null,
            choice: e ? str(e.choice) || null : null,
          };
        })(),
        invoices: invoicesBy.get(str(j.id)) ?? [],
        messages: messagesBy.get(str(j.id)) ?? [],
      };
    }),
  };
}

/** Which client a job belongs to. */
export async function customerOfJob(jobId: string): Promise<string | null> {
  const sb = await createClient();
  const { data } = await sb.from("jobs").select("property:properties!inner(customer_id)").eq("id", jobId).maybeSingle();
  const prop = (data as { property?: { customer_id?: string } | { customer_id?: string }[] } | null)?.property;
  const row = Array.isArray(prop) ? prop[0] : prop;
  return row?.customer_id ?? null;
}
