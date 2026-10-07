import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ShirtShop } from "@/components/shirts/shirt-shop";
import { listShirtOrders } from "@/lib/data/shirt-orders";

/** Company shirts: the designs, and ordering them by design, style, colour and size. */
export const dynamic = "force-dynamic";

export default async function ShirtsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("shirts", "/admin");
  const orders = await listShirtOrders().catch(() => null);
  return <ShirtShop orders={orders} canSave={orders !== null} />;
}
