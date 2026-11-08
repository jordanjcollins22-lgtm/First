import { notFound } from "next/navigation";

import { reviewPagesEnabled } from "@/lib/review-pages";
import { priceProject } from "@/lib/pricing-report";
import { SAMPLE_PROJECT } from "@/lib/pricing-report-sample";
import { DEFAULT_VARIABLES } from "@/lib/pricing-variables";
import { PricingReportView } from "@/components/pricing/pricing-report";
import { PrintButton } from "@/components/receipt/print-button";

/**
 * The one-page project pricing report for a sample bed refresh, priced from
 * the code's starting variables, so it can be checked on a preview without a
 * job or a saved row in the database.
 */
export const dynamic = "force-dynamic";

export default function ReviewPricingPage() {
  if (!reviewPagesEnabled()) notFound();
  const report = priceProject(SAMPLE_PROJECT, DEFAULT_VARIABLES);
  return (
    <main className="mx-auto max-w-[8.5in] px-2 py-4 print:p-0">
      <div className="mb-2 flex justify-end print:hidden">
        <PrintButton />
      </div>
      <div className="print-root rounded-lg border border-stone-200 shadow-sm print:rounded-none print:border-0 print:shadow-none">
        <PricingReportView report={report} variables={DEFAULT_VARIABLES} date="Sample" />
      </div>
      <style>{`@media print {
        @page { size: letter portrait; margin: 0.4in; }
        .print-root { left: 0; right: 0; width: auto !important; }
      }`}</style>
    </main>
  );
}
