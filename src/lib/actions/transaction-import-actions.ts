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
  netCents,
  parseTransactionCsv,
  previewTransactions,
  type TransactionDraft,
  type TransactionPreview,
} from "@/lib/transaction-import";
import { linkToJob, tallyLine, type ImportTally, type JobCandidate } from "@/lib/payment-linking";
import { jobsToMarkSold, soldLine } from "@/lib/paid-job-stage";

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
      /** What the money does when it meets this database, rather than what
       * the file says on its own. The whole point of a preview: a total that
       * comes out short should be explainable before it is imported, not
       * after somebody notices it on a dashboard. */
      matchedCents: number;
      unmatchedCents: number;
      matchedCount: number;
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
    let matchedCents = 0;
    let unmatchedCents = 0;
    let matchedCount = 0;

    for (const draft of report.drafts) {
      // Only settled rows carry money, so only they are counted here. A
      // refund in the unmatched pile would make the gap look bigger than the
      // money actually at stake.
      const value = isSettled(draft) ? draft.amountCents : 0;
      if (matchClient(draft, clients)) {
        matchedCents += value;
        if (value > 0) matchedCount += 1;
      } else {
        unmatchedCents += value;
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
      matchedCents,
      unmatchedCents,
      matchedCount,
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
  sourceName: string,
  /** Make a contact for a payer nobody has on file, rather than dropping the
   * money. On by default: a payment with nowhere to go is money missing from
   * the total, and the row carries everything a contact needs. */
  createMissing = true
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
    /** Card fees, as expenses. Kept separate from the payment on purpose:
     * what the client paid is what they paid, and burying the fee inside the
     * receipt is how it stops being visible. */
    const feeRows: Record<string, unknown>[] = [];
    const markPaid = new Set<string>();
    const unmatchedClients: string[] = [];
    const tally: ImportTally = {
      recorded: 0,
      linked: 0,
      unlinked: 0,
      skipped: report.skipped.length,
      refunded: 0,
      notSettled: 0,
      clientsCreated: 0,
      feesCents: 0,
      totalCents: 0,
    };

    for (const draft of report.drafts) {
      let client = matchClient(draft, clients);

      // A payer nobody has on file used to be a skipped row, which meant
      // money quietly missing from the total. Everything needed to make the
      // contact is on the row — the CRM's id, a name, an email — so the
      // contact is made and the payment lands. A client created from a
      // payment is a client we definitely have, which is more than can be
      // said for some of the book.
      if (!client && createMissing) {
        const made = await createClientFrom(supabase, organizationId, draft);
        if (made) {
          clients.push(made);
          client = made;
          tally.clientsCreated += 1;
        }
      }

      if (!client) {
        const who = draft.name ?? draft.email ?? draft.phone ?? "someone";
        if (!unmatchedClients.includes(who)) unmatchedClients.push(who);
        tally.skipped += 1;
        continue;
      }

      const link = linkToJob(draft.amountCents, jobsByCustomer.get(client.id) ?? []);
      if (link.jobId) tally.linked += 1;
      else tally.unlinked += 1;

      // A failed charge is not money received and a refund is money given
      // back. The payments table is what the business took, and a total built
      // from it has to reconcile with the bank. Both are counted and reported
      // rather than written in.
      if (!isSettled(draft)) {
        if (draft.status === "refunded") tally.refunded += 1;
        else tally.notSettled += 1;
        continue;
      }
      if (link.jobId) markPaid.add(link.jobId);

      rows.push({
        organization_id: organizationId,
        customer_id: client.id,
        job_id: link.jobId,
        // What was kept, not what was charged: a partial refund on an
        // otherwise good payment is money we gave back.
        amount_cents: netCents(draft),
        method: draft.method ?? "import",
        // No date in the file means no date here. Filing it under the day it
        // was imported would look like an answer.
        ...(draft.paidOn ? { received_at: draft.paidOn } : {}),
        note: [draft.description, draft.status !== "succeeded" ? draft.status : null]
          .filter(Boolean)
          .join(" · ") || null,
        external_id: draft.externalId,
        // The processor's own id, so a row here can be matched against what
        // the processor says without going by name and amount.
        stripe_payment_intent_id: draft.chargeId,
        source: sourceName.trim() || "import",
        recorded_by: profile.id,
      });
      tally.recorded += 1;
      if (isSettled(draft)) tally.totalCents += netCents(draft);

      if (draft.feeCents > 0 && draft.externalId) {
        feeRows.push({
          organization_id: organizationId,
          direction: "out",
          category: "processing_fees",
          // The ledger works in whole currency rather than cents.
          amount: draft.feeCents / 100,
          occurred_on: draft.paidOn ?? new Date().toISOString().slice(0, 10),
          method: "card",
          party: draft.method ?? "Card processor",
          job_id: link.jobId,
          note: `Processing fee on ${draft.name ?? "a payment"}`,
          external_id: `fee:${draft.externalId}`,
          created_by: profile.id,
        });
        tally.feesCents += draft.feeCents;
      }
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

    // Fees, after the payments, and never at the cost of them: a ledger that
    // did not take is a number to fix, and a payment that did not land is
    // money missing.
    if (feeRows.length > 0) {
      for (const batch of chunk(feeRows, BATCH)) {
        const { error } = await supabase
          .from("ledger_entries")
          .upsert(batch as never, { onConflict: "organization_id,external_id" });
        if (error) {
          console.error("Recording processing fees failed:", error);
          tally.feesCents = 0;
          break;
        }
      }
    }

    // The half that moves the board. Done after the money is safely in, so a
    // failure here costs the stage change rather than the payments.
    let sold = 0;
    if (markPaid.size > 0) {
      const jobIds = [...markPaid];
      const paidAt = new Date().toISOString();

      // When we got the money. Only ever written once: a second payment
      // against the same job is an instalment, not a new settlement date.
      const { error } = await supabase
        .from("job_proposals")
        .update({ paid_at: paidAt })
        .in("job_id", jobIds)
        .is("paid_at", null);
      if (error) console.error("Marking proposals paid failed:", error);

      // And the stage. Recording the money is not the same as moving the
      // work: the board reads a job's own status, which knows nothing about
      // a payment, so without this a year of receipts leaves every card in
      // Sales, quoted and apparently still waiting on a yes.
      const { data: jobRows } = await supabase
        .from("jobs")
        .select("id, status")
        .in("id", jobIds);

      const toMove = jobsToMarkSold(
        ((jobRows ?? []) as { id: string; status: string }[]).map((j) => ({
          jobId: j.id,
          status: j.status,
        }))
      );

      if (toMove.length > 0) {
        const { error: stageError } = await supabase
          .from("jobs")
          .update({ status: "approved" })
          .in("id", toMove);
        if (stageError) console.error("Moving paid jobs failed:", stageError);
        else sold = toMove.length;
      }

      for (const jobId of jobIds) revalidateJobViews(jobId);
    }

    revalidatePath("/pipeline");
    revalidatePath("/admin/payments");

    return {
      ok: true,
      message: [tallyLine(tally), soldLine(sold)].filter(Boolean).join(" "),
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


/**
 * Makes a contact from a payment row.
 *
 * Carries the CRM's own id across, so the next import of anything matches
 * this person rather than making them again, and marks where they came from
 * so the office can tell a client created from a receipt apart from one
 * somebody added on purpose.
 */
async function createClientFrom(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  draft: TransactionDraft
): Promise<ClientRow | null> {
  const name = draft.name?.trim() || draft.email?.trim() || "Unnamed payer";

  const { data, error } = await supabase
    .from("customers")
    .insert({
      organization_id: organizationId,
      name,
      email: draft.email,
      phone: draft.phone,
      external_id: draft.customerExternalId,
      contact_type: "client",
      source: "Payment import",
    })
    .select("id, name, email, phone, external_id")
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as ClientRow;
}
