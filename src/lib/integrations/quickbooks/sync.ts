import { financeDb, getFinanceSettings } from "@/lib/data/finance-settings";
import { localDay } from "@/lib/finance/dates";
import { qboClientFor, QboError, type QboClient } from "@/lib/integrations/quickbooks/api";
import {
  contentHash,
  customerBody,
  displayName,
  invoiceBody,
  paymentBody,
  qboQuote,
  requestIdFor,
  shouldPush,
  type LocalCustomer,
  type LocalInvoice,
  type LocalPayment,
} from "@/lib/integrations/quickbooks/map";
import { log } from "@/lib/log";

/**
 * The one-way push to QuickBooks Online: customers, then invoices, then
 * payments, so each thing it points at is already there.
 *
 * Safe to run any number of times. qbo_sync_map remembers what each app
 * record became in QuickBooks and a fingerprint of what was sent, so an
 * unchanged record is skipped and a changed one is updated, never created
 * twice; every create also carries a request id QuickBooks deduplicates on,
 * for the case where it succeeded but the answer was lost.
 *
 * Only records created on or after the sync was switched on are pushed
 * (qbo_sync_from), unless the owner picked an earlier date to backfill.
 */

type Entity = "customer" | "invoice" | "payment";

interface MapRow {
  entity: Entity;
  local_id: string;
  qbo_id: string | null;
  sync_token: string | null;
  content_hash: string | null;
  attempts: number;
  last_error: string | null;
}

export interface SyncOutcome {
  ran: boolean;
  pushed: Record<Entity, number>;
  failed: number;
  summary: string;
}

/** Records per run, so one run stays inside a cron's time. The rest go next hour. */
const PER_RUN = 150;

export async function runQboSync(organizationId: string, trigger: "cron" | "manual"): Promise<SyncOutcome> {
  const pushed: Record<Entity, number> = { customer: 0, invoice: 0, payment: 0 };
  const settings = await getFinanceSettings(organizationId);
  if (!settings.qboSyncEnabled) return { ran: false, pushed, failed: 0, summary: "QuickBooks sync is off." };
  const since = settings.qboSyncFrom ?? settings.qboSyncStartedAt;
  if (!since) return { ran: false, pushed, failed: 0, summary: "QuickBooks sync has no start date." };

  const db = financeDb();
  const { data: run } = await db.from("qbo_sync_runs").insert({ organization_id: organizationId, trigger }).select("id").single();
  const runId = (run as { id: string } | null)?.id ?? null;
  const finish = async (failed: number, summary: string) => {
    if (runId) {
      await db.from("qbo_sync_runs").update({ finished_at: new Date().toISOString(), pushed, failed, summary }).eq("id", runId);
    }
    return { ran: true, pushed, failed, summary };
  };

  const connected = await qboClientFor(organizationId);
  if ("error" in connected) return finish(0, connected.error);
  const { client } = connected;
  const itemId = (typeof connected.settings.item_id === "string" && connected.settings.item_id.trim()) || "1";

  // What changed since the start date.
  const [{ data: invRows }, { data: payRows }] = await Promise.all([
    db
      .from("invoices")
      .select("id, amount, status, sent_at, created_at, updated_at, stripe_invoice_id, jobs(name, job_number, properties(customer_id))")
      .eq("organization_id", organizationId)
      .or(`created_at.gte.${since},updated_at.gte.${since}`)
      .order("created_at")
      .limit(500),
    db
      .from("payments")
      .select("id, customer_id, amount_cents, method, received_at, created_at, stripe_invoice_id, stripe_payment_intent_id, receipt_number")
      .eq("organization_id", organizationId)
      .gte("created_at", since)
      .not("customer_id", "is", null)
      .order("created_at")
      .limit(500),
  ]);

  type InvRow = {
    id: string;
    amount: number;
    status: string;
    sent_at: string | null;
    created_at: string;
    stripe_invoice_id: string | null;
    jobs: { name: string | null; job_number: number | null; properties: { customer_id: string | null } | null } | null;
  };
  type PayRow = {
    id: string;
    customer_id: string;
    amount_cents: number;
    method: string;
    received_at: string;
    stripe_invoice_id: string | null;
    stripe_payment_intent_id: string | null;
    receipt_number: string | null;
  };

  const invoices: LocalInvoice[] = ((invRows ?? []) as unknown as InvRow[])
    .filter((r) => r.jobs?.properties?.customer_id && r.amount > 0)
    .map((r) => ({
      id: r.id,
      customerId: r.jobs!.properties!.customer_id!,
      amount: Number(r.amount),
      description: r.jobs?.name || "Landscaping services",
      txnDate: localDay(r.sent_at ?? r.created_at),
      dueDate: null,
      docNumber: r.jobs?.job_number ? `JS-${r.jobs.job_number}` : null,
      voided: r.status === "void",
    }));
  const invoiceByStripe = new Map(
    ((invRows ?? []) as unknown as InvRow[]).filter((r) => r.stripe_invoice_id).map((r) => [r.stripe_invoice_id!, r.id])
  );
  const payments: LocalPayment[] = ((payRows ?? []) as unknown as PayRow[])
    .filter((p) => p.amount_cents > 0)
    .map((p) => ({
      id: p.id,
      customerId: p.customer_id,
      amount: p.amount_cents / 100,
      txnDate: localDay(p.received_at),
      method: p.method,
      invoiceId: p.stripe_invoice_id ? (invoiceByStripe.get(p.stripe_invoice_id) ?? null) : null,
      reference: p.receipt_number ?? p.stripe_payment_intent_id ?? null,
    }));

  const customerIds = [...new Set([...invoices.map((i) => i.customerId), ...payments.map((p) => p.customerId)])];
  const { data: custRows } = customerIds.length
    ? await db.from("customers").select("id, name, email, phone, import_address").in("id", customerIds)
    : { data: [] };
  const customers: LocalCustomer[] = ((custRows ?? []) as { id: string; name: string; email: string | null; phone: string | null; import_address: string | null }[]).map(
    (c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, address: c.import_address })
  );

  // An invoice paid by a payment from before the start date may be mapped
  // already; read every map row for the ids in play.
  const ids = [...customerIds, ...invoices.map((i) => i.id), ...payments.map((p) => p.id), ...payments.map((p) => p.invoiceId).filter(Boolean) as string[]];
  const map = new Map<string, MapRow>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db
      .from("qbo_sync_map")
      .select("entity, local_id, qbo_id, sync_token, content_hash, attempts, last_error")
      .eq("organization_id", organizationId)
      .in("local_id", ids.slice(i, i + 200));
    for (const r of (data ?? []) as MapRow[]) map.set(`${r.entity}:${r.local_id}`, r);
  }

  let budget = PER_RUN;
  let failed = 0;
  const errors: string[] = [];

  const save = async (entity: Entity, localId: string, patch: Partial<MapRow>) => {
    const prev = map.get(`${entity}:${localId}`);
    const row = {
      organization_id: organizationId,
      entity,
      local_id: localId,
      qbo_id: patch.qbo_id ?? prev?.qbo_id ?? null,
      sync_token: patch.sync_token ?? prev?.sync_token ?? null,
      content_hash: patch.content_hash ?? prev?.content_hash ?? null,
      attempts: patch.attempts ?? 0,
      last_error: patch.last_error ?? null,
      synced_at: patch.last_error ? (prev as { synced_at?: string } | undefined)?.synced_at ?? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await db.from("qbo_sync_map").upsert(row);
    map.set(`${entity}:${localId}`, { ...row, entity } as MapRow);
  };

  const push = async (entity: Entity, localId: string, body: Record<string, unknown>, opts: { voidIt?: boolean } = {}) => {
    const key = `${entity}:${localId}`;
    const prev = map.get(key);
    const hash = contentHash({ body, voided: Boolean(opts.voidIt) });
    const decision = shouldPush(prev, hash);
    if (decision === "skip" || budget <= 0) return;
    if (opts.voidIt && decision === "create") return; // never existed there; nothing to void
    budget--;
    const resource = entity === "customer" ? "Customer" : entity === "invoice" ? "Invoice" : "Payment";
    try {
      let saved: { Id: string; SyncToken: string } | null = null;
      if (decision === "create") {
        saved = await createWithDuplicateCheck(client, entity, resource, body, requestIdFor(organizationId, entity, localId));
      } else {
        const current = await client.request<Record<string, { Id: string; SyncToken: string }>>("GET", `${entity}/${prev!.qbo_id}`);
        const token = current[resource]?.SyncToken ?? prev!.sync_token ?? "0";
        if (opts.voidIt) {
          const res = await client.request<Record<string, { Id: string; SyncToken: string }>>("POST", "invoice", {
            body: { Id: prev!.qbo_id, SyncToken: token },
            query: { operation: "void" },
          });
          saved = res[resource] ?? null;
        } else {
          const res = await client.request<Record<string, { Id: string; SyncToken: string }>>("POST", entity, {
            body: { ...body, Id: prev!.qbo_id, SyncToken: token, sparse: true },
          });
          saved = res[resource] ?? null;
        }
      }
      if (!saved?.Id) throw new Error(`QuickBooks didn't return the ${entity}.`);
      await save(entity, localId, { qbo_id: saved.Id, sync_token: saved.SyncToken, content_hash: hash, attempts: 0, last_error: null });
      pushed[entity]++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : "Unknown error";
      errors.push(`${entity} ${localId.slice(0, 8)}: ${message}`);
      await save(entity, localId, { attempts: (prev?.attempts ?? 0) + 1, last_error: message.slice(0, 500) });
      if (err instanceof QboError && err.status === 401) throw err; // the token is dead; stop the run
    }
  };

  try {
    for (const c of customers) await push("customer", c.id, customerBody(c));

    const qboCustomer = (id: string) => map.get(`customer:${id}`)?.qbo_id ?? null;
    for (const inv of invoices) {
      const cust = qboCustomer(inv.customerId);
      if (!cust) continue; // its customer failed; it is retried next run
      await push("invoice", inv.id, invoiceBody(inv, cust, itemId), { voidIt: inv.voided });
    }
    for (const p of payments) {
      const cust = qboCustomer(p.customerId);
      if (!cust) continue;
      const qboInvoice = p.invoiceId ? (map.get(`invoice:${p.invoiceId}`)?.qbo_id ?? null) : null;
      await push("payment", p.id, paymentBody(p, cust, qboInvoice));
    }
  } catch (err) {
    log.warn("qbo.sync.stopped", { organizationId, message: err instanceof Error ? err.message : String(err) });
  }

  const total = pushed.customer + pushed.invoice + pushed.payment;
  const summary =
    failed > 0
      ? `${total} sent, ${failed} failed. ${errors.slice(0, 3).join(" · ")}`
      : total > 0
        ? `${total} sent: ${pushed.customer} customers, ${pushed.invoice} invoices, ${pushed.payment} payments.`
        : "Everything is already in QuickBooks.";
  if (failed) log.warn("qbo.sync.failures", { organizationId, failed });
  return finish(failed, summary.slice(0, 1000));
}

/**
 * Creates a record. A customer whose name is already taken in QuickBooks
 * (error 6240) is the same person typed in by the bookkeeper before the
 * sync existed: it is linked to, not duplicated.
 */
async function createWithDuplicateCheck(
  client: QboClient,
  entity: Entity,
  resource: string,
  body: Record<string, unknown>,
  requestId: string
): Promise<{ Id: string; SyncToken: string } | null> {
  try {
    const res = await client.request<Record<string, { Id: string; SyncToken: string }>>("POST", entity, { body, query: { requestid: requestId } });
    return res[resource] ?? null;
  } catch (err) {
    if (entity === "customer" && err instanceof QboError && err.code === "6240") {
      const name = displayName({ name: String(body.DisplayName ?? ""), id: "" });
      const found = await client.request<{ QueryResponse?: { Customer?: { Id: string; SyncToken: string }[] } }>("GET", "query", {
        query: { query: `select Id, SyncToken from Customer where DisplayName = ${qboQuote(name)}` },
      });
      const match = found.QueryResponse?.Customer?.[0];
      if (match) return match;
    }
    throw err;
  }
}

export interface QboSyncStatus {
  lastRun: { startedAt: string; finishedAt: string | null; summary: string | null; failed: number; pushed: Record<string, number> } | null;
  mapped: Record<Entity, number>;
  errors: { entity: string; localId: string; error: string; attempts: number }[];
}

/** What the Finance page shows about the sync. */
export async function qboSyncStatus(organizationId: string): Promise<QboSyncStatus> {
  const db = financeDb();
  const [{ data: runs }, { data: mapRows }] = await Promise.all([
    db.from("qbo_sync_runs").select("started_at, finished_at, summary, failed, pushed").eq("organization_id", organizationId).order("started_at", { ascending: false }).limit(1),
    db.from("qbo_sync_map").select("entity, local_id, qbo_id, last_error, attempts").eq("organization_id", organizationId).limit(5000),
  ]);
  const run = (runs ?? [])[0] as { started_at: string; finished_at: string | null; summary: string | null; failed: number; pushed: Record<string, number> } | undefined;
  const rows = (mapRows ?? []) as { entity: Entity; local_id: string; qbo_id: string | null; last_error: string | null; attempts: number }[];
  const mapped: Record<Entity, number> = { customer: 0, invoice: 0, payment: 0 };
  for (const r of rows) if (r.qbo_id) mapped[r.entity]++;
  return {
    lastRun: run ? { startedAt: run.started_at, finishedAt: run.finished_at, summary: run.summary, failed: run.failed, pushed: run.pushed } : null,
    mapped,
    errors: rows.filter((r) => r.last_error).slice(0, 20).map((r) => ({ entity: r.entity, localId: r.local_id, error: r.last_error!, attempts: r.attempts })),
  };
}
