"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { revalidateJobViews } from "@/lib/revalidate-job";
import { findDuplicateCustomer } from "@/lib/dedupe";
import { chunk } from "@/lib/chunk";
import {
  isSettled,
  parseTransactionCsv,
  previewTransactions,
  type TransactionDraft,
  type TransactionPreview,
} from "@/lib/transaction-import";
import { linkToJob, tallyLine, type ImportTally, type JobCandidate } from "@/lib/payment-linking";

export type TransactionImportResult =
  | { ok: true; message: string; tally: ImportTally; unmatchedClients: string[] }
  | { ok: false; message: string };

export type TransactionPreviewResult =
  | {
      ok: true;
      preview: TransactionPreview;
      unmatchedHeaders: string[];
      skipped: { row: number; reason: string }[];
      /** Rows whose payer is not a contact here. Shown before anybody imports,
       * because the fix is adding the contact, not re-running the file. */
      unmatchedClients: string[];
      sample: { name: string; amount: number; date: string | null; status: string }[];
    }
  | { ok: false; message: string };

/** How many rows to write per statement. */
const BATCH = 500;

interface ClientRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  /** The CRM id the contact import stored. The strongest match there is. */
  external_id: string | null;
}

/**
 * What this file would do, without doing it.
 *
 * A payments file is the one somebody runs once and then spends an evening
 * unpicking. Seeing the counts, the columns nothing claimed, and the payers
 * who are not contacts here costs one extra tap and catches a mis-read column
 * before it is three hundred wrong rows.
 */
export async function previewTransactionImport(
  csvText: string
): Promise<TransactionPreviewResult> {
  try {
    if (!(await getCurrentProfile())) return { ok: false, message: "Sign in first." };
    if (!csvText.trim()) return { ok: false, message: "Paste or upload a file first." };

    const report = parseTransactionCsv(csvText);
    if (report.drafts.length === 0) {
      return {
        ok: false,
        message: report.skipped[0]?.reason ?? "Nothing in that file could be read as a payment.",
      };
    }

    const clients = await loadClients();
    const unmatchedClients: string[] = [];
    for (const draft of report.drafts) {
      if (!matchClient(draft, clients)) {
        const who = draft.name ?? draft.email ?? draft.phone ?? "someone";
        if (!unmatchedClients.includes(who)) unmatchedClients.push(who);
      }
    }

    return {
      ok: true,
      preview: previewTransactions(report.drafts),
      unmatchedHeaders: report.unmatchedHeaders,
      skipped: report.skipped.slice(0, 10),
      unmatchedClients: unmatchedClients.slice(0, 20),
      sample: report.drafts.slice(0, 5).map((d) => ({
        name: d.name ?? d.email ?? "",
        amount: d.amountCents / 100,
        date: d.paidOn,
        status: d.status,
      })),
    };
  } catch (err) {
    console.error("previewTransactionImport failed:", err);
    return { ok: false, message: "Couldn't read that file." };
  }
}

/**
 * Brings the money in and joins it up.
 *
 * Three things happen per row and they are deliberately separable. The
 * payment is recorded against the client, which is worth having on its own.
 * Where the job can be known it is attached. And where it is attached and the
 * money settles the quote, the proposal is marked paid, which is what moves
 * the card down the board.
 *
 * The last of those is the only one that changes what the pipeline says, and
 * it only happens where a job was picked without guessing. A payment on the
 * wrong job is worse than one on no job, because nobody goes looking for it.
 */
export async function importTransactions(
  csvText: string,
  sourceName: string
): Promise<TransactionImportResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };

    const report = parseTransactionCsv(csvText);
    if (report.drafts.length === 0) {
      return { ok: false, message: report.skipped[0]?.reason ?? "Nothing to import." };
    }

    const [supabase, organizationId, clients] = await Promise.all([
      createClient(),
      getCurrentOrganizationId(),
      loadClients(),
    ]);

    const jobsByCustomer = await loadJobs();

    const rows: Record<string, unknown>[] = [];
    const markPaid = new Set<string>();
    const unmatchedClients: string[] = [];
    const tally: ImportTally = {
      recorded: 0,
      linked: 0,
      unlinked: 0,
      skipped: report.skipped.length,
      totalCents: 0,
    };

    for (const draft of report.drafts) {
      const client = matchClient(draft, clients);
      if (!client) {
        const who = draft.name ?? draft.email ?? draft.phone ?? "someone";
        if (!unmatchedClients.includes(who)) unmatchedClients.push(who);
        tally.skipped += 1;
        continue;
      }

      const link = linkToJob(draft.amountCents, jobsByCustomer.get(client.id) ?? []);
      if (link.jobId) tally.linked += 1;
      else tally.unlinked += 1;

      // A refund or a failed row is still recorded — it is part of what
      // happened with this client — but it never marks a job paid.
      if (link.jobId && isSettled(draft)) markPaid.add(link.jobId);

      rows.push({
        organization_id: organizationId,
        customer_id: client.id,
        job_id: link.jobId,
        amount_cents: draft.amountCents,
        method: draft.method ?? "import",
        // No date in the file means no date here. Filing it under the day it
        // was imported would look like an answer.
        ...(draft.paidOn ? { received_at: draft.paidOn } : {}),
        note: [draft.description, draft.status !== "succeeded" ? draft.status : null]
          .filter(Boolean)
          .join(" · ") || null,
        external_id: draft.externalId,
        source: sourceName.trim() || "import",
        recorded_by: profile.id,
      });
      tally.recorded += 1;
      if (isSettled(draft)) tally.totalCents += draft.amountCents;
    }

    // Batched and upserted on the exporting system's own id, so running the
    // same file twice updates rather than paying everybody twice.
    for (const batch of chunk(rows, BATCH)) {
      const withId = batch.filter((r) => r.external_id);
      const withoutId = batch.filter((r) => !r.external_id);

      if (withId.length > 0) {
        const { error } = await supabase
          .from("payments")
          .upsert(withId as never, { onConflict: "organization_id,external_id" });
        if (error) return { ok: false, message: describeImportError(error.message) };
      }
      if (withoutId.length > 0) {
        const { error } = await supabase.from("payments").insert(withoutId as never);
        if (error) return { ok: false, message: describeImportError(error.message) };
      }
    }

    // The half that moves the board. Done after the money is safely in, so a
    // failure here costs the stage change rather than the payments.
    if (markPaid.size > 0) {
      const paidAt = new Date().toISOString();
      const { error } = await supabase
        .from("job_proposals")
        .update({ paid_at: paidAt })
        .in("job_id", [...markPaid])
        .is("paid_at", null);
      if (error) console.error("Marking proposals paid failed:", error);
      for (const jobId of markPaid) revalidateJobViews(jobId);
    }

    revalidatePath("/pipeline");
    revalidatePath("/admin/payments");

    return {
      ok: true,
      message: tallyLine(tally),
      tally,
      unmatchedClients: unmatchedClients.slice(0, 20),
    };
  } catch (err) {
    console.error("importTransactions failed:", err);
    return { ok: false, message: "Couldn't import that file." };
  }
}

function describeImportError(message: string): string {
  if (/external_id|constraint|42P10/i.test(message)) {
    return "This needs its database migration. Run supabase/migrations/0139_payment_import.sql, then try again.";
  }
  return message;
}

/** Every contact, to match payers against. Bounded by the size of the book
 * rather than by time, and paged so a book over a thousand is not silently
 * truncated — matching against a truncated list is how a re-import fails to
 * find people it found last time. */
async function loadClients(): Promise<ClientRow[]> {
  const supabase = await createClient();
  const all: ClientRow[] = [];
  const size = 1000;

  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, email, phone, external_id")
      .range(from, from + size - 1);
    if (error) throw error;

    const page = (data ?? []) as unknown as ClientRow[];
    all.push(...page);
    if (page.length < size) break;
  }
  return all;
}

/** The jobs each client has, with what their proposal says they cost. */
async function loadJobs(): Promise<Map<string, JobCandidate[]>> {
  const supabase = await createClient();

  const [{ data: properties }, { data: jobs }, { data: proposals }] = await Promise.all([
    supabase.from("properties").select("id, customer_id"),
    supabase.from("jobs").select("id, property_id, created_at"),
    supabase.from("job_proposals").select("job_id, total_cost, paid_at"),
  ]);

  const customerByProperty = new Map(
    ((properties ?? []) as { id: string; customer_id: string }[]).map((p) => [p.id, p.customer_id])
  );
  const proposalByJob = new Map(
    ((proposals ?? []) as { job_id: string; total_cost: number | null; paid_at: string | null }[]).map(
      (p) => [p.job_id, p]
    )
  );

  const byCustomer = new Map<string, JobCandidate[]>();
  for (const job of (jobs ?? []) as { id: string; property_id: string; created_at: string }[]) {
    const customerId = customerByProperty.get(job.property_id);
    if (!customerId) continue;

    const proposal = proposalByJob.get(job.id);
    const list = byCustomer.get(customerId) ?? [];
    list.push({
      jobId: job.id,
      totalCents: proposal?.total_cost != null ? Math.round(proposal.total_cost * 100) : null,
      paid: Boolean(proposal?.paid_at),
      createdAt: job.created_at,
    });
    byCustomer.set(customerId, list);
  }
  return byCustomer;
}

/**
 * Finding the client this payment belongs to.
 *
 * The CRM's own contact id first, because the contact import stored exactly
 * that against every client and it is the only key here that cannot be two
 * different people. A payments export carries it on every row, and matching a
 * name is guesswork by comparison: two Bertrands in the same county is not a
 * rare thing to have on the books.
 *
 * Everything else falls back to the same ladder the contact import climbs.
 */
function matchClient(draft: TransactionDraft, clients: ClientRow[]): ClientRow | null {
  if (draft.customerExternalId) {
    const exact = clients.find((c) => c.external_id === draft.customerExternalId);
    if (exact) return exact;
  }

  return (
    (findDuplicateCustomer(clients, {
      name: draft.name,
      email: draft.email,
      phone: draft.phone,
    }) as ClientRow | null) ?? null
  );
}
