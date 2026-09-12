import { redirect } from "next/navigation";
import Link from "next/link";
import { Frame } from "lucide-react";

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

  return (
    <>
      {/* The other printed thing, from the page somebody opens looking for a
          printed thing. A page in a menu nobody thinks to open is a page
          nobody finds. */}
      <div className="mx-auto w-full max-w-5xl px-4 pt-4">
        <Link
          href="/admin/marketing/poster"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/60 px-3 py-2 text-sm font-medium hover:bg-accent/50"
        >
          <Frame className="h-4 w-4" aria-hidden /> Neighborhood Sign for a picture frame
        </Link>
      </div>
      <DoorHangerSheet slots={slots} />
    </>
  );
}
