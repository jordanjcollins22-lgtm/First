import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { listMowOrders } from "@/lib/data/mow-orders";
import { MowOrdersBoard } from "@/components/mow/mow-orders-board";

/**
 * Quick mows: paid for on the quick mow page and waiting for a call to set
 * the day, oldest first, with the 24-hour clock on each. Below them, people
 * who opened the card form and didn't finish, who are worth a call too.
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
