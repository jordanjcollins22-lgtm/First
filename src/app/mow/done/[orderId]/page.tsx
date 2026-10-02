import { CheckCircle2, Clock } from "lucide-react";

import { isSupabaseAdminConfigured } from "@/lib/env";
import { mowOrderSummary, settleMowOrder } from "@/lib/actions/public-mow-actions";

/**
 * Where they land after paying. Settled here as well as by the webhook, so
 * somebody who just paid never reads "not paid yet". Its one job beyond
 * the receipt is saying what happens next: a call within 24 hours.
 */
export const dynamic = "force-dynamic";

export default async function MowDonePage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { orderId } = await params;
  const { paid } = await searchParams;
  if (!isSupabaseAdminConfigured) return <Missing />;
  if (paid) await settleMowOrder(orderId).catch(() => {});
  const order = await mowOrderSummary(orderId).catch(() => null);
  if (!order) return <Missing />;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-12">
      <div className="flex flex-col items-center gap-2 text-center">
        <CheckCircle2 className="h-12 w-12 text-primary" />
        <h1 className="text-2xl font-bold">{order.isPaid ? `You're on the list, ${order.firstName}!` : "Nearly there"}</h1>
        <p className="text-sm text-muted-foreground">
          {order.isPaid ? "Your first mow is paid for." : "Your payment is still going through. Give it a moment and refresh."}
        </p>
      </div>
      {order.isPaid && (
        <div className="flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p className="text-sm">
            <span className="font-semibold">What happens next:</span> a team member will call you shortly to confirm {order.day ? `your mow on ${order.day}` : "your mowing day"}.
            {order.phone ? ` Questions before then? Call or text ${order.phone}.` : ""}
          </p>
        </div>
      )}
      <dl className="divide-y divide-border rounded-xl border border-border text-sm">
        <Row label="Address" value={order.address} />
        <Row label="Lawn" value={order.tierLabel} />
        {order.day && <Row label="Day" value={order.day} />}
        <Row label="Paid" value={order.paid} />
      </dl>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 px-4 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function Missing() {
  return <p className="mx-auto max-w-md px-4 py-20 text-center text-lg font-semibold">We couldn&apos;t find that order.</p>;
}
