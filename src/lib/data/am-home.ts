import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import { invoicesDue, isMine, later, leadsToBook, waitingMessages, type ClientMessage, type DueInvoice, type LeadJob, type LeadToBook } from "@/lib/am-home";
import type { Profile } from "@/types/domain";

/**
 * What the account manager's two home screens read: the leads to ring and
 * book, the prices waiting on them, the client messages to answer, the
 * invoices out, their own clients and the issues on them.
 *
 * Read as whoever is signed in (row security applies), for the person being
 * shown, so Preview as draws exactly their day. Each list fails on its own:
 * a table that can't be read is an empty list and a log line, never a broken
 * screen.
 */

type Row = Record<string, unknown>;
// Joined selects over several tables by name; the generated types would need
// a branch per shape for no gain in a read-only summary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;

const str = (x: unknown) => (typeof x === "string" ? x : "");
const num = (x: unknown) => (typeof x === "number" ? x : Number(x ?? 0) || 0);
/** "12 Haystack Court, Forest Hill, MD 21050" → "12 Haystack Court, Forest Hill" */
export const shortAddress = (address: unknown) => {
  const parts = str(address).split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2 ? `${parts[0]}, ${parts[1]}` : parts[0] || "No address";
};

async function db(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient;
}

async function read(what: string, q: Promise<{ data: unknown; error: { message: string } | null }>): Promise<Row[]> {
  try {
    const { data, error } = await q;
    if (error) {
      log.warn("am_home.read_failed", { what, error: error.message });
      return [];
    }
    return (data ?? []) as Row[];
  } catch (err) {
    log.warn("am_home.read_failed", { what, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

const customerOf = (j: Row): Row => (((j.property as Row | null)?.customer as Row | null) ?? {}) as Row;

/* ------------------------------------------------------------------ */
/* Sales                                                                */
/* ------------------------------------------------------------------ */

export interface ToApprove {
  proposalId: string;
  jobId: string;
  customerName: string;
  address: string;
  total: number;
  writtenAt: string;
}

export interface AmSales {
  leads: LeadToBook[];
  toApprove: ToApprove[];
}

export async function loadAmSales(viewer: Profile, now: Date = new Date()): Promise<AmSales> {
  const sb = await db();
  const org = viewer.organization_id;
  const jobCols = "id,status,created_at,evaluation_date,evaluation_status,cancelled_at,declined_at,property:properties!inner(address,customer:customers!inner(id,name,phone,account_manager_id,do_not_contact,organization_id))";
  const [leadRows, proposalRows] = await Promise.all([
    read(
      "leads",
      (sb.from("jobs").select(jobCols) as Q)
        .eq("property.customer.organization_id", org)
        .eq("status", "estimating")
        .is("cancelled_at", null)
        .is("declined_at", null)
        .order("created_at", { ascending: false })
        .limit(300)
    ),
    read(
      "proposals",
      (sb.from("job_proposals").select("id,job_id,total_cost,discount_amount,created_at,job:jobs!inner(id,status,property:properties!inner(address,customer:customers!inner(name,account_manager_id)))") as Q)
        .eq("organization_id", org)
        .eq("status", "needs_approval")
        .order("created_at", { ascending: true })
        .limit(100)
    ),
  ]);

  const leads: LeadJob[] = leadRows.map((j) => {
    const c = customerOf(j);
    return {
      jobId: str(j.id),
      customerName: str(c.name) || "Unnamed client",
      phone: str(c.phone) || null,
      address: shortAddress((j.property as Row | null)?.address),
      managerId: str(c.account_manager_id) || null,
      doNotContact: Boolean(c.do_not_contact),
      createdAt: str(j.created_at),
      evaluationDate: str(j.evaluation_date) || null,
      evaluationStatus: str(j.evaluation_status) || null,
    };
  });

  const toApprove: ToApprove[] = proposalRows
    .filter((p) => {
      const job = (p.job as Row | null) ?? {};
      return job.status !== "cancelled" && isMine(str(customerOf(job).account_manager_id) || null, viewer.id);
    })
    .map((p) => {
      const job = (p.job as Row | null) ?? {};
      return {
        proposalId: str(p.id),
        jobId: str(p.job_id),
        customerName: str(customerOf(job).name) || "Unnamed client",
        address: shortAddress((job.property as Row | null)?.address),
        total: num(p.total_cost) - num(p.discount_amount),
        writtenAt: str(p.created_at),
      };
    });

  return { leads: leadsToBook(leads, viewer.id, now), toApprove };
}

/* ------------------------------------------------------------------ */
/* Accounts                                                             */
/* ------------------------------------------------------------------ */

export interface WaitingMessage extends ClientMessage {
  customerName: string;
  address: string;
}

export interface MyClient {
  id: string;
  name: string;
  phone: string | null;
  openIssues: number;
}

export interface OpenIssue {
  id: string;
  title: string;
  severity: string;
  customerId: string;
  customerName: string;
  createdAt: string;
}

export interface AmAccounts {
  messages: WaitingMessage[];
  invoices: DueInvoice[];
  clients: MyClient[];
  issues: OpenIssue[];
}

/** How far back a client message still counts as waiting. Older than this is history. */
const MESSAGE_DAYS = 45;

export async function loadAmAccounts(viewer: Profile, now: Date = new Date()): Promise<AmAccounts> {
  const sb = await db();
  const org = viewer.organization_id;
  const since = new Date(now.getTime() - MESSAGE_DAYS * 86_400_000).toISOString();

  const [clientMsgs, teamMsgs, invoiceRows, clientRows] = await Promise.all([
    read(
      "client messages",
      (sb.from("job_messages").select("job_id,body,author_name,created_at") as Q)
        .eq("organization_id", org)
        .eq("channel", "external")
        .eq("author_type", "client")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(300)
    ),
    read(
      "team replies",
      (sb.from("job_messages").select("job_id,created_at") as Q)
        .eq("organization_id", org)
        .eq("channel", "external")
        .eq("author_type", "team")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(600)
    ),
    read(
      "invoices",
      (sb.from("invoices").select("id,job_id,amount,sent_at,created_at,pay_by,job:jobs!inner(property:properties!inner(customer:customers!inner(name,account_manager_id)))") as Q)
        .eq("organization_id", org)
        .eq("status", "open")
        .order("created_at", { ascending: true })
        .limit(200)
    ),
    read(
      "clients",
      (sb.from("customers").select("id,name,phone") as Q).eq("organization_id", org).eq("account_manager_id", viewer.id).order("name").limit(200)
    ),
  ]);

  // Who each messaged job belongs to, and how far each conversation is answered.
  const jobIds = [...new Set(clientMsgs.map((m) => str(m.job_id)).filter(Boolean))];
  const [jobRows, readRows] = jobIds.length
    ? await Promise.all([
        read(
          "message jobs",
          (sb.from("jobs").select("id,property:properties!inner(address,customer:customers!inner(name,account_manager_id,organization_id))") as Q)
            .in("id", jobIds)
            .eq("property.customer.organization_id", org)
        ),
        read("conversation reads", (sb.from("conversation_reads").select("job_id,read_through") as Q).eq("channel", "external").in("job_id", jobIds)),
      ])
    : [[], []];
  const jobById = new Map(jobRows.map((j) => [str(j.id), j]));
  const answered = new Map<string, string>();
  for (const m of teamMsgs) answered.set(str(m.job_id), later(answered.get(str(m.job_id)), str(m.created_at)) ?? "");
  for (const r of readRows) answered.set(str(r.job_id), later(answered.get(str(r.job_id)), str(r.read_through)) ?? "");

  const mineMsgs = clientMsgs.filter((m) => {
    const j = jobById.get(str(m.job_id));
    return j && isMine(str(customerOf(j).account_manager_id) || null, viewer.id);
  });
  const messages: WaitingMessage[] = waitingMessages(
    mineMsgs.map((m) => ({ jobId: str(m.job_id), body: str(m.body), authorName: str(m.author_name) || null, createdAt: str(m.created_at) })),
    answered
  ).map((m) => {
    const j = jobById.get(m.jobId) ?? {};
    return { ...m, customerName: str(customerOf(j).name) || m.authorName || "Client", address: shortAddress((j.property as Row | null)?.address) };
  });

  const invoices = invoicesDue(
    invoiceRows.map((i) => {
      const c = customerOf((i.job as Row | null) ?? {});
      return {
        invoiceId: str(i.id),
        jobId: str(i.job_id),
        customerName: str(c.name) || "Client",
        managerId: str(c.account_manager_id) || null,
        amount: num(i.amount),
        sentAt: str(i.sent_at) || null,
        createdAt: str(i.created_at),
        payBy: str(i.pay_by) || null,
      };
    }),
    viewer.id
  );

  // Open issues on their own clients' jobs.
  const clientIds = clientRows.map((c) => str(c.id));
  const issueRows = clientIds.length
    ? await read(
        "issues",
        (sb.from("job_issues").select("id,title,severity,created_at,job:jobs!inner(property:properties!inner(customer_id))") as Q)
          .eq("organization_id", org)
          .eq("status", "open")
          .in("job.property.customer_id", clientIds)
          .order("created_at", { ascending: false })
          .limit(50)
      )
    : [];
  const nameOf = new Map(clientRows.map((c) => [str(c.id), str(c.name) || "Client"]));
  const issues: OpenIssue[] = issueRows.map((i) => {
    const customerId = str(((i.job as Row | null)?.property as Row | null)?.customer_id);
    return { id: str(i.id), title: str(i.title) || "Issue", severity: str(i.severity), customerId, customerName: nameOf.get(customerId) ?? "Client", createdAt: str(i.created_at) };
  });
  const issuesBy = new Map<string, number>();
  for (const i of issues) issuesBy.set(i.customerId, (issuesBy.get(i.customerId) ?? 0) + 1);

  const clients: MyClient[] = clientRows
    .map((c) => ({ id: str(c.id), name: str(c.name) || "Unnamed client", phone: str(c.phone) || null, openIssues: issuesBy.get(str(c.id)) ?? 0 }))
    // Clients with something open on them first.
    .sort((a, b) => b.openIssues - a.openIssues || a.name.localeCompare(b.name));

  return { messages, invoices, clients, issues };
}
