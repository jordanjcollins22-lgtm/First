import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QuoteForm } from "@/components/govcon/quote-form";
import { getQuotePortal, isGovconDbConfigured } from "@/lib/data/govcon";
import { formatDate } from "@/lib/govcon/templates";

export const metadata: Metadata = { title: "Quote request", robots: { index: false } };

/**
 * Public page a subcontractor lands on from the RFQ email. Shows only the
 * cleaned scope of work (no solicitation number or government contacts).
 */
export default async function QuotePage({ params }: { params: Promise<{ token: string }> }) {
  if (!isGovconDbConfigured()) notFound();
  const { token } = await params;
  const portal = await getQuotePortal(token);
  if (!portal) notFound();
  const { job, rfq, sub } = portal;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <div>
        <p className="text-sm text-muted-foreground">Quote request from {portal.companyName}</p>
        <h1 className="text-2xl font-bold">{job.location ? `Work in ${job.location}` : "Quote request"}</h1>
        <p className="text-muted-foreground">
          For {sub?.name ?? "your company"} · quotes due <strong>{formatDate(rfq.quote_due_at)}</strong>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Scope of work</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {job.period && (
            <p>
              <strong>Period:</strong> {job.period}
            </p>
          )}
          {job.siteVisit?.offered && (
            <p>
              <strong>Site visit:</strong> {job.siteVisit.mandatory ? "Mandatory" : "Available"}
              {job.siteVisit.details ? ` — ${job.siteVisit.details}` : ""}. Reply to our email if you&apos;d like to attend.
            </p>
          )}
          <div className="whitespace-pre-wrap rounded-md bg-muted p-4 leading-relaxed">{job.scope}</div>
          {job.wageDetermination && (
            <p className="text-xs text-muted-foreground">
              Federal service contract: Service Contract Act wage determination {job.wageDetermination} applies — workers must be
              paid at least the listed wage and fringe rates.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your quote</CardTitle>
        </CardHeader>
        <CardContent>
          {portal.existingQuote && (
            <p className="mb-4 rounded-md bg-accent p-3 text-sm">
              We have your quote of ${Number(portal.existingQuote.amount).toLocaleString()}. Submitting again replaces it.
            </p>
          )}
          {job.open ? (
            <QuoteForm
              token={token}
              defaults={{ contactEmail: sub?.email ?? null, contactPhone: sub?.phone ?? null }}
              requiresSmallBusiness={job.requiresSmallBusiness}
            />
          ) : (
            <p className="text-sm text-muted-foreground">This quote request is closed. Thanks for your interest!</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
