import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { getPaymentsData } from "@/lib/data/payments";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { PaymentsDashboard } from "@/components/payments/payments-dashboard";

/**
 * Money in and out, all of it.
 *
 * Gated to admin and overhead — the same people who could already see pay
 * rates and costs, so folding Overhead in here exposes nothing new. The
 * Overhead tab still checks the overhead role separately, because that role
 * exists precisely to scope who sees fixed costs.
 */
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
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <h1 className="mb-1 text-2xl font-bold">Money</h1>
      <p className="mb-4 text-sm text-muted-foreground sm:mb-6 sm:text-base">
        Everything in and out — cash jobs, invoices, team pay, materials and overhead.
      </p>
      <PaymentsDashboard data={data} canSeeOverhead={!!profile?.roles.includes("overhead")} />
    </div>
  );
}
