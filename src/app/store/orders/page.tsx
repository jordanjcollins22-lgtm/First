import Link from "next/link";

import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { OrderCard } from "@/components/store/order-card";
import { listMerchOrders } from "@/lib/data/merch";
import { isSupabaseConfigured } from "@/lib/env";

export default async function StoreOrdersPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const orders = await listMerchOrders();
  const open = orders.filter((o) => o.status !== "delivered" && o.status !== "cancelled");
  const done = orders.filter((o) => o.status === "delivered" || o.status === "cancelled");

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/store" className="text-sm text-muted-foreground hover:text-primary">
        &larr; Team Store
      </Link>
      <h1 className="mt-2 mb-1 text-2xl font-bold">Store Orders</h1>
      <p className="mb-6 text-muted-foreground">
        Approve an order, download its print file, and place it with the vendor (paste the copied details into
        their order form or an email). Add the tracking number when it ships and the team member gets a text.
      </p>

      {orders.length === 0 && <p className="text-sm text-muted-foreground">No orders yet.</p>}

      <div className="flex flex-col gap-3">
        {open.map((order) => (
          <OrderCard key={order.id} order={order} />
        ))}
      </div>

      {done.length > 0 && (
        <>
          <h2 className="mt-10 mb-3 text-lg font-semibold">Finished</h2>
          <div className="flex flex-col gap-3">
            {done.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
