import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { checkTabAccess } from "@/lib/data/access";
import { listDoorHangerSlots } from "@/lib/data/door-hangers";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { DoorHangerSheet } from "@/components/marketing/door-hanger-sheet";

export default async function DoorHangersPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { allowed } = await checkTabAccess("door-hangers");
  if (!allowed) redirect("/admin/tools");

  const slots = await listDoorHangerSlots().catch(() => []);

  return <DoorHangerSheet slots={slots} />;
}
