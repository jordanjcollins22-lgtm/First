"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InvoicePanel } from "@/components/job/invoice-panel";
import { raiseInvoiceForJob } from "@/lib/actions/job-invoice-actions";
import type { Invoice } from "@/types/domain";

/**
 * The invoice on a job, and the way to raise one when there isn't.
 *
 * This tab used to render nothing at all until an invoice existed, and an
 * invoice only ever came into existence down one narrow path on the client's
 * own screen. So a job sold over the phone opened an Invoice tab that was
 * blank, with no hint that billing lived somewhere else or that it did not
 * live anywhere.
 *
 * When they accepted is on this panel rather than only on the proposal,
 * because it is the date the bill runs from: the deposit is due against it and
 * a client asking "when did I agree to this?" is asking whoever is looking at
 * the invoice.
 */
export function InvoiceSection({
  jobId,
  invoice,
  acceptedLabel,
  agreedTotal,
  stripeReady,
}: {
  jobId: string;
  invoice: Invoice | null;
  /** "Accepted Tue, Sep 8, 2026 at 9:14 PM EDT", or null if they have not. */
  acceptedLabel: string | null;
  agreedTotal: number | null;
  stripeReady: boolean;
}) {
  const router = useRouter();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (invoice) {
    return (
      <div className="flex flex-col gap-3">
        <InvoicePanel invoice={invoice} />
        {acceptedLabel && <AcceptedLine label={acceptedLabel} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <p className="font-semibold">Invoice</p>
        <span className="rounded-full border border-muted-foreground/30 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          Not raised
        </span>
      </div>

      {acceptedLabel && <AcceptedLine label={acceptedLabel} />}

      {agreedTotal != null && agreedTotal > 0 && (
        <p className="text-sm">
          Agreed total{" "}
          <span className="font-semibold">
            ${Math.round(agreedTotal).toLocaleString()}
          </span>
        </p>
      )}

      {stripeReady ? (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="sm"
            className="w-fit"
            disabled={pending}
            onClick={() => {
              setResult(null);
              startTransition(async () => {
                const outcome = await raiseInvoiceForJob(jobId);
                setResult(outcome);
                if (outcome.ok) router.refresh();
              });
            }}
          >
            {pending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Send the invoice
          </Button>
          <p className="text-xs text-muted-foreground">
            Bills the agreed total in full and texts the client the payment link. For a deposit or
            instalments, use the Payment tab instead.
          </p>
        </div>
      ) : (
        <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-xs text-amber-800">
          Stripe isn&apos;t connected, so we can&apos;t send a payable invoice from here. Record one you
          raised elsewhere under Proposals &amp; Invoices.
        </p>
      )}

      {result && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            result.ok ? "bg-emerald-500/15 text-emerald-700" : "bg-amber-500/15 text-amber-800"
          }`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}

function AcceptedLine({ label }: { label: string }) {
  return <p className="text-xs text-muted-foreground">{label}</p>;
}
