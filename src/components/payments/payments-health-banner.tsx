import { AlertTriangle } from "lucide-react";

/**
 * The till being broken, said where somebody will see it.
 *
 * The text goes out the moment it happens, which is the part that matters.
 * This is for the morning after: somebody who opened Money to look at a
 * number should not have to remember a text from Saturday to know that
 * nothing has been collectable since.
 *
 * Nothing renders while it is working. A permanent green tick saying payments
 * are fine is a thing people stop reading, and then they stop reading it on
 * the day it turns red.
 */
export function PaymentsHealthBanner({
  state,
  detail,
  since,
}: {
  state: "ok" | "down";
  detail: string | null;
  /** When it stopped answering, already worded. */
  since: string | null;
}) {
  if (state !== "down") return null;

  return (
    <div className="mb-4 flex gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-destructive">
          Stripe isn&apos;t answering, so nobody can pay by card.
        </p>
        {since && <p className="mt-0.5 text-xs text-muted-foreground">Since {since}.</p>}
        {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
        <p className="mt-1 text-xs text-muted-foreground">
          Check the Stripe key on the deployment and that the account is in good standing. This
          clears itself within a day of Stripe answering again, or the next time anyone tries to
          take a payment.
        </p>
      </div>
    </div>
  );
}
