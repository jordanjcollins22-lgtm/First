import { isSupabaseAdminConfigured } from "@/lib/env";
import { receiptByToken } from "@/lib/actions/receipt-actions";
import { ReceiptDocument } from "@/components/receipt/receipt-document";

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
 */
export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseAdminConfigured) return <NotFound />;

  const receipt = await receiptByToken(token).catch(() => null);
  if (!receipt) return <NotFound />;

  return (
    <main className="min-h-full bg-muted/40 px-4 py-8 print:bg-white print:p-0">
      <ReceiptDocument receipt={receipt} />
    </main>
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
