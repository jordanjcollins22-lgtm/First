import { Check, ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Invoice } from "@/types/domain";

const STATUS_LABEL: Record<string, string> = {
  open: "Sent — awaiting payment",
  paid: "Paid",
  void: "Voided",
  uncollectible: "Uncollectible",
};

const STATUS_STYLE: Record<string, string> = {
  open: "border-blue-400/40 bg-blue-400/10 text-blue-700",
  paid: "border-primary/40 bg-primary/10 text-primary",
  void: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
  uncollectible: "border-destructive/40 bg-destructive/10 text-destructive",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Read-only summary of the Stripe invoice sent automatically once the
 * client accepts the proposal — Stripe hosts the actual payment page, this
 * just shows where things stand. Nothing to click to send; that already
 * happened. */
export function InvoicePanel({ invoice }: { invoice: Invoice | null }) {
  if (!invoice) return null;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="font-semibold">Invoice</p>
          <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", STATUS_STYLE[invoice.status])}>
            {STATUS_LABEL[invoice.status]}
          </span>
        </div>
        {invoice.hosted_invoice_url && (
          <a
            href={invoice.hosted_invoice_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View on Stripe
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-lg font-semibold">${Math.round(invoice.amount).toLocaleString()}</p>
        {invoice.status === "paid" && invoice.paid_at ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-primary" />
            Paid {formatDate(invoice.paid_at)}
          </p>
        ) : (
          invoice.sent_at && <p className="text-xs text-muted-foreground">Sent {formatDate(invoice.sent_at)}</p>
        )}
      </div>
    </div>
  );
}
