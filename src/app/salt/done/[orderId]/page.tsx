import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { isSupabaseAdminConfigured } from "@/lib/env";
import { saltOrderSummary, settleSaltOrder } from "@/lib/actions/public-salt-actions";

/**
 * Where they land after paying.
 *
 * Settled here as well as on the webhook, because a webhook thirty seconds
 * behind should not leave somebody who just paid looking at a page that says
 * their order has not been paid for.
 *
 * The one thing this page has to do, beyond confirming the money, is answer
 * "what happens now". A client who has just prepaid a winter and is told
 * nothing will ring in a week to check, and that call is the whole saving
 * undone.
 */
export const dynamic = "force-dynamic";

export default async function SaltDonePage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { orderId } = await params;
  const { paid } = await searchParams;

  if (!isSupabaseAdminConfigured) return <NotFound />;
  if (paid) await settleSaltOrder(orderId).catch(() => {});

  const order = await saltOrderSummary(orderId).catch(() => null);
  if (!order) return <NotFound />;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-12">
      <div className="flex flex-col items-center gap-2 text-center">
        <CheckCircle2 className="h-10 w-10 text-primary" />
        <h1 className="text-2xl font-bold">
          {order.paid ? "You are on the route." : "Nearly there."}
        </h1>
        <p className="text-sm text-muted-foreground">
          {order.paid
            ? `Thanks ${order.name.split(" ")[0]}. That is ${order.treatments} treatments paid for and booked.`
            : "Your payment is still going through. Give it a moment and refresh."}
        </p>
      </div>

      <dl className="divide-y divide-border rounded-xl border border-border">
        <Row label="Address" value={order.address} />
        <Row label="What we are treating" value={order.surface} />
        {order.petFriendly && <Row label="Product" value="Pet safe blend" />}
        <Row label="Treatments" value={`${order.treatments} prepaid`} />
        <Row label="Paid" value={order.total} />
      </dl>

      <section className="rounded-xl border border-border bg-muted/30 p-4">
        <p className="text-sm font-medium">What happens now</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Nothing, on your side. We will reach out as the weather gets closer to confirm your
          address and how you want the walks done, and we will make sure your order is covered
          before the first storm. You will not need to call us when it snows.
        </p>
      </section>

      <p className="text-center text-xs text-muted-foreground">
        Keep this page if you like, or{" "}
        <Link href="/salt" className="underline">
          book another address
        </Link>
        .
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium">{value}</dd>
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-20 text-center">
      <p className="text-lg font-semibold">We cannot find that order.</p>
      <p className="text-sm text-muted-foreground">
        If you have paid and this is not right, get in touch and we will sort it out.
      </p>
    </div>
  );
}
