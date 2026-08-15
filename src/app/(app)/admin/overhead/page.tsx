import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { listOverheadExpenses } from "@/lib/data/overhead";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { OverheadList } from "@/components/overhead/overhead-list";

export default async function OverheadPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const profile = await getCurrentProfile();
  if (!profile?.roles.includes("overhead")) {
    redirect("/attractors");
  }

  const expenses = await listOverheadExpenses();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Overhead</h1>
      <p className="mb-6 text-muted-foreground">Recurring monthly costs — only visible to people with the Overhead role.</p>
      <OverheadList expenses={expenses} />
    </div>
  );
}
