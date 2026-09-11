import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { requireJobAccess } from "@/lib/data/access";
import { getJobRecord } from "@/lib/data/job-record";
import { recordFileName } from "@/lib/job-record";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { JobRecordDocument } from "@/components/job/job-record-document";
import { PrintButton } from "@/components/weeds/print-button";

/**
 * The job record, at its own address.
 *
 * For the day a client rings upset or a callback is booked: every proposal,
 * every message, what was agreed, what was not, what got added and what was
 * paid, on paper, so the account manager can walk the property with the
 * whole story in hand rather than a phone with five tabs open.
 *
 * Two copies from one page. The full copy is for the team and carries their
 * own notes. `?copy=client` is the one that can be handed across the table.
 * Printing goes through the browser, which is also how it becomes a PDF:
 * "Save as PDF" is a destination in every print dialog, and the file name is
 * set so it lands as the job and the client rather than "page.pdf".
 */
export default async function JobRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams?: Promise<{ copy?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const { jobId } = await params;
  const { copy } = (await searchParams) ?? {};
  const clientCopy = copy === "client";

  await requireJobAccess(jobId, ["job-detail", "project-data", "evaluations", "pipeline"]);

  const record = await getJobRecord(jobId, { clientCopy });
  if (!record) notFound();

  const fileName = recordFileName(record.job, record.customer.name).replace(/\.pdf$/, "");

  return (
    <div className="mx-auto max-w-[8.5in] px-4 py-4 sm:py-6">
      {/* The file name a browser offers on "Save as PDF" is the document
          title, so it is set here rather than left as the app's. */}
      <title>{fileName}</title>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/jobs/${jobId}`} className="flex min-h-9 items-center gap-1 text-sm text-muted-foreground hover:text-primary">
          <ArrowLeft className="h-4 w-4" />
          Back to the job
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={clientCopy ? `/jobs/${jobId}/record` : `/jobs/${jobId}/record?copy=client`}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent/50"
          >
            {clientCopy ? "Switch to the full copy" : "Switch to the client copy"}
          </Link>
          <PrintButton label="Print or save as PDF" />
        </div>
      </div>

      <p className="mb-3 text-xs text-muted-foreground print:hidden">
        {clientCopy
          ? "Client copy: the team's notes, pinned remarks, issues and reading history are left off. Safe to hand over."
          : "Full copy: includes the team's own notes. Switch to the client copy before handing it to anybody outside the business."}
      </p>

      {/* Runs to several pages, so the page box gets a margin the paper keeps
          on every one of them, and the print root is left to flow rather than
          pinned to a single sheet. */}
      <style>{`@media print {
        @page { size: letter portrait; margin: 0.5in 0.55in; }
        .print-root { position: static !important; left: 0; right: 0; width: auto !important; }
      }`}</style>

      <JobRecordDocument record={record} />
    </div>
  );
}
