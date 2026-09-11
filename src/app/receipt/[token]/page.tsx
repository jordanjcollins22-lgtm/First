import { isSupabaseAdminConfigured } from "@/lib/env";
import { receiptByToken } from "@/lib/actions/receipt-actions";
import {
  balanceLine,
  longDay,
  METHOD_LABEL,
  money,
  RECEIPT_HEADLINE,
  receiptLine,
} from "@/lib/receipt";
import { PrintButton } from "@/components/receipt/print-button";

/**
 * A receipt, where the client's link lands.
 *
 * No sign-in, because the person holding it has no account and asking them
 * to make one to see proof they already paid is absurd. The token in the
 * address is the whole authorisation and it identifies one payment.
 *
 * Nothing on this page asks for anything. An invoice asks; a receipt
 * confirms. There is no balance-due box, no pay button, no link back into a
 * checkout. A client looking at a receipt has already paid and being asked
 * again is alarming.
 *
 * Plain on purpose, and laid out so it prints on one page. The download is
 * the browser's own print-to-PDF, which every phone has and which turns this
 * exact page into the file they keep.
 */
export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseAdminConfigured) return <NotFound />;

  const receipt = await receiptByToken(token).catch(() => null);
  if (!receipt) return <NotFound />;

  const balance = balanceLine(receipt);

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-10 print:max-w-none print:px-0 print:py-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-primary print:text-black">
            {receipt.businessName}
          </p>
          <h1 className="mt-1 text-2xl font-bold">{RECEIPT_HEADLINE}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{receiptLine(receipt)}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Receipt</p>
          <p className="font-mono text-sm font-semibold">{receipt.number}</p>
        </div>
      </div>

      <dl className="mt-6 divide-y divide-border rounded-xl border border-border print:rounded-none">
        <Row label="Amount received" value={money(receipt.amountCents)} strong />
        <Row label="Received on" value={longDay(receipt.receivedAt)} />
        <Row label="Paid by" value={METHOD_LABEL[receipt.method]} />
        {receipt.payerName && <Row label="From" value={receipt.payerName} />}
        {receipt.forWhat && <Row label="For" value={receipt.forWhat} />}
        {receipt.address && <Row label="Property" value={receipt.address} />}
        {receipt.reference && <Row label="Reference" value={receipt.reference} />}
        {receipt.note && <Row label="Note" value={receipt.note} />}
      </dl>

      {balance && (
        <p className="mt-4 rounded-xl border border-border bg-muted/30 p-3 text-sm print:rounded-none print:bg-transparent">
          {balance}
        </p>
      )}

      <p className="mt-6 text-sm text-muted-foreground">
        Thank you for having us. Keep this for your records. If anything on it is not right, get in
        touch and we will correct it.
      </p>

      <div className="mt-6">
        <PrintButton />
      </div>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-right text-sm ${strong ? "text-lg font-bold tabular-nums" : "font-medium"}`}>
        {value}
      </dd>
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-20 text-center">
      <p className="text-lg font-semibold">We cannot find that receipt.</p>
      <p className="text-sm text-muted-foreground">
        If you have paid and this is not right, get in touch and we will send you a fresh one.
      </p>
    </div>
  );
}
