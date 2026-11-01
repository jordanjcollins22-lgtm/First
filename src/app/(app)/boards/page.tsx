import { redirect } from "next/navigation";

import { requireTab } from "@/lib/data/access";
import { isDepartment } from "@/lib/kanban/board";

/**
 * The department boards live on each department as its Board subtab. This
 * address is the permission's home: it sends /boards?department=x there, and
 * a bare /boards to Sales.
 */
export const dynamic = "force-dynamic";

export default async function BoardsPage({ searchParams }: { searchParams: Promise<{ department?: string }> }) {
  await requireTab("kanban", "/my-day");
  const asked = (await searchParams).department ?? "";
  if (asked === "admin") redirect("/admin#board");
  redirect(`/${isDepartment(asked) ? asked : "sales"}?tab=board`);
}
