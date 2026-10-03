import { notFound } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ShirtOrderSheet } from "@/components/shirts/shirt-order-sheet";
import { getShirtOrder } from "@/lib/data/shirt-orders";

/** One shirt order, as the sheet for the print shop. */
export const dynamic = "force-dynamic";

export default async function ShirtOrderPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("shirts", "/admin");
  const { id } = await params;
  const order = await getShirtOrder(id).catch(() => null);
  if (!order) notFound();
  return <ShirtOrderSheet order={order} />;
}
