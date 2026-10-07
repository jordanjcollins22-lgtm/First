import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { listMowOrders } from "@/lib/data/mow-orders";
import { MowOrdersBoard } from "@/components/mow/mow-orders-board";

/**
 * The quick mow pipeline: every request from the quick mow page, from a
 * price seen, to paid and waiting on its 24-hour call, to scheduled and
 * mowed. Each request is already a client and a job in the system.
 */
export const dynamic = "force-dynamic";

export default async function MowOrdersPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("mow-orders", "/sales");
  const orders = await listMowOrders().catch((err) => {
    console.error("Quick mows failed to load:", err);
    return null;
  });
  return <MowOrdersBoard orders={orders} />;
}
