import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { listOverheadExpenses } from "@/lib/data/overhead";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { OverheadList } from "@/components/overhead/overhead-list";

// Only Jordan's account can see this page — it's personal overhead, not a
// team/admin-role concern, so this checks the exact email rather than the
// admin/crew role.
const JORDAN_EMAIL = "jordanjcollins22@gmail.com";

export default async function OverheadPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.email !== JORDAN_EMAIL) {
    redirect("/attractors");
  }

  const expenses = await listOverheadExpenses();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Overhead</h1>
      <p className="mb-6 text-muted-foreground">Recurring monthly costs — only visible to you.</p>
      <OverheadList expenses={expenses} />
    </div>
  );
}
