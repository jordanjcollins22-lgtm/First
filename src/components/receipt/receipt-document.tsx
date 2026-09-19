import { CheckCircle2 } from "lucide-react";

import {
  addressLines,
  balanceLine,
  longDay,
  METHOD_LABEL,
  money,
  RECEIPT_HEADLINE,
  type Receipt,
} from "@/lib/receipt";
import { PrintButton } from "@/components/receipt/print-button";

/**
 * The receipt as a document.
 *
 * Pure: a receipt in, markup out, nothing fetched. That is what lets it be
 * rendered on the client's page, previewed from the settings screen, and
 * screenshotted in a test harness with the same code, so the thing the
 * office previews is the thing the client gets.
 *
 * Laid out as a document rather than as a screen: a letterhead, a stamp, a
 * table, a signature line's worth of thanks. It is the thing they will file
 * or forward to a landlord, and it should look like it was meant to be.
 * Printing uses the browser's own print-to-PDF, so the print styles are the
 * download.
 */
export function ReceiptDocument({ receipt }: { receipt: Receipt }) {
  return (
      <article className="print-root mx-auto w-full max-w-[8.5in] rounded-2xl border border-border bg-white text-[#14181a] shadow-sm print:max-w-none print:rounded-none print:border-0 print:shadow-none">
        <Letterhead receipt={receipt} />

        <div className="px-6 pb-8 pt-6 sm:px-10 print:px-[0.7in]">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight">{RECEIPT_HEADLINE}</h1>
              <p className="mt-1 text-sm text-[#5b6660]">
                Received {longDay(receipt.receivedAt)}
              </p>
            </div>
            <Stamp />
          </div>

          <section className="mt-6 grid gap-6 sm:grid-cols-2">
            <Block label="Received from">
              <p className="text-base font-semibold">{receipt.payerName ?? "Client"}</p>
              {receipt.address && <p className="text-sm text-[#5b6660]">{receipt.address}</p>}
            </Block>
            <Block label="Receipt">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-[#5b6660]">Number</dt>
                <dd className="font-mono font-semibold">{receipt.number}</dd>
                <dt className="text-[#5b6660]">Paid by</dt>
                <dd>{METHOD_LABEL[receipt.method]}</dd>
                {receipt.reference && (
                  <>
                    <dt className="text-[#5b6660]">Reference</dt>
                    <dd className="font-mono text-xs">{receipt.reference}</dd>
                  </>
                )}
              </dl>
            </Block>
          </section>

          <table className="mt-8 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-[#14181a] text-left text-xs uppercase tracking-wide text-[#5b6660]">
                <th className="py-2 font-semibold">Description</th>
                <th className="py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[#e3e7e2]">
                <td className="py-3 pr-4 align-top">
                  <p className="font-medium">{receipt.forWhat ?? "Landscaping services"}</p>
                  {receipt.note && <p className="mt-0.5 text-xs text-[#5b6660]">{receipt.note}</p>}
                </td>
                <td className="py-3 text-right align-top tabular-nums">{money(receipt.amountCents)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td className="pr-4 pt-4 text-right text-xs uppercase tracking-wide text-[#5b6660]">
                  Total received
                </td>
                <td className="whitespace-nowrap pt-4 text-right text-2xl font-bold tabular-nums text-[#2f6d3c]">
                  {money(receipt.amountCents)}
                </td>
              </tr>
            </tfoot>
          </table>

          <Balance receipt={receipt} />

          <p className="mt-8 text-sm text-[#5b6660]">
            Thank you for having us. Keep this for your records. If anything on it is not right,
            get in touch and we will put it straight.
          </p>

          <div className="mt-6 print:hidden">
            <PrintButton />
          </div>
        </div>

        <Footer receipt={receipt} />
      </article>
  );
}

/**
 * The top of the page: who this is from, and how to reach them.
 *
 * A logo where there is one, the name as a wordmark where there is not. The
 * contact block leaves out what is blank rather than printing "Phone:" next
 * to nothing, because a receipt with an empty field on it looks unfinished.
 */
function Letterhead({ receipt }: { receipt: Receipt }) {
  const lines = addressLines(receipt.business);
  const { phone, email, website, logoUrl } = receipt.business;
  const hasContact = lines.length > 0 || phone || email || website;

  return (
    <header className="flex flex-col gap-4 border-b-4 border-[#2f6d3c] px-6 py-6 sm:flex-row sm:items-start sm:justify-between sm:px-10 print:flex-row print:px-[0.7in] print:pt-[0.6in]">
      <div className="flex items-center gap-3">
        {logoUrl ? (
          // Plain img on purpose: a logo path may be an external URL and this
          // page must print without a Next image loader in the way.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="h-14 w-auto max-w-[200px] object-contain" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#2f6d3c] text-xl font-bold text-white">
            {initials(receipt.businessName)}
          </div>
        )}
        <div>
          <p className="text-lg font-bold leading-tight">{receipt.businessName || "Receipt"}</p>
          <p className="text-xs uppercase tracking-wide text-[#5b6660]">Payment receipt</p>
        </div>
      </div>

      {hasContact && (
        // Left under the name on a phone, right-aligned beside it on paper.
        // A right-aligned block under a left-aligned name reads as lopsided.
        <address className="text-left text-xs not-italic leading-5 text-[#5b6660] sm:text-right print:text-right">
          {lines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
          {phone && <span className="block">{phone}</span>}
          {email && <span className="block">{email}</span>}
          {website && <span className="block">{website}</span>}
        </address>
      )}
    </header>
  );
}

/** The one word the page exists to say, said like a stamp. */
function Stamp() {
  return (
    <div
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border-2 border-[#2f6d3c] px-3 py-1.5 text-sm font-bold uppercase tracking-widest text-[#2f6d3c]"
      style={{ transform: "rotate(-4deg)" }}
    >
      <CheckCircle2 className="h-4 w-4" />
      Paid
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs uppercase tracking-wide text-[#5b6660]">{label}</p>
      {children}
    </div>
  );
}

/**
 * What is still owed, said carefully or not at all.
 *
 * Silent when we do not know. "$0 outstanding" on a job nobody has totalled
 * tells the client they are paid up, and they will hold us to it.
 */
function Balance({ receipt }: { receipt: Receipt }) {
  const line = balanceLine(receipt);
  if (!line) return null;
  const settled = (receipt.outstandingCents ?? 0) <= 0;
  return (
    <p
      className={`mt-6 rounded-lg border px-4 py-3 text-sm ${
        settled ? "border-[#2f6d3c]/40 bg-[#2f6d3c]/5" : "border-[#e3e7e2] bg-[#f7f8f6]"
      } print:bg-transparent`}
    >
      {line}
    </p>
  );
}

function Footer({ receipt }: { receipt: Receipt }) {
  const { phone, email, website } = receipt.business;
  const bits = [phone, email, website].filter(Boolean);
  return (
    <footer className="flex flex-col items-center gap-0.5 border-t border-[#e3e7e2] px-6 py-4 text-center text-[11px] text-[#5b6660] sm:flex-row sm:justify-between sm:px-10 print:flex-row print:justify-between print:px-[0.7in]">
      <span>
        {receipt.businessName}
        {bits.length > 0 && ` · ${bits.join(" · ")}`}
      </span>
      {/* One token. A receipt number broken across two lines is a number
          somebody reads back wrong over the phone. */}
      <span className="whitespace-nowrap font-mono">Receipt {receipt.number}</span>
    </footer>
  );
}

/** Two letters for the wordmark square when there is no logo. */
function initials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "R";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

