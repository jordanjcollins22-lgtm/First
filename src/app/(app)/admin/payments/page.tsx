import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { getPaymentsData } from "@/lib/data/payments";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { PaymentsDashboard } from "@/components/payments/payments-dashboard";

/** Money in and out. Gated to admin and overhead — the same people who can
 * already see pay rates and costs, so this exposes nothing new to anyone. */
export default async function PaymentsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const profile = await getCurrentProfile();
  const allowed = profile?.roles.includes("admin") || profile?.roles.includes("overhead");
  if (!allowed) redirect("/attractors");

  let data: Awaited<ReturnType<typeof getPaymentsData>> | null = null;
  try {
    data = await getPaymentsData();
  } catch (err) {
    console.error("Payments page failed to load:", err);
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-bold">Payments</h1>
        <p className="rounded-lg border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
          Couldn&apos;t load payments. If this is a fresh setup, the team_payments table may not exist yet — run{" "}
          <code>supabase/migrations/0074_team_payments.sql</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Payments</h1>
      <p className="mb-6 text-muted-foreground">
        What the team is owed and paid, what clients owe you, and what&apos;s actually left.
      </p>
      <PaymentsDashboard data={data} />
    </div>
  );
}
