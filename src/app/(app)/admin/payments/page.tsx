import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile, listProfiles } from "@/lib/data/team";
import { getPaymentsData } from "@/lib/data/payments";
import { getCommissionByManager, type ManagerCommission } from "@/lib/data/commission";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { PaymentsDashboard } from "@/components/payments/payments-dashboard";
import { PageTabs } from "@/components/ui/page-tabs";
import { Timesheet } from "@/components/payments/timesheet";
import { listDayEntries, listPayPeople } from "@/lib/data/time-clock";
import { localDayKey } from "@/lib/data/crew-day";

/**
 * Money in and out, all of it.
 *
 * Gated to admin and overhead — the same people who could already see pay
 * rates and costs, so folding Overhead in here exposes nothing new. The
 * Overhead tab still checks the overhead role separately, because that role
 * exists precisely to scope who sees fixed costs.
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const profile = await getCurrentProfile();
  const isAdmin = Boolean(profile?.roles.includes("admin"));
  const allowed = isAdmin || profile?.roles.includes("overhead");
  if (!allowed) redirect("/attractors");

  let data: Awaited<ReturnType<typeof getPaymentsData>> | null = null;
  try {
    data = await getPaymentsData();
  } catch (err) {
    console.error("Payments page failed to load:", err);
  }

  // Loaded separately: commission is a read across four other tables, and a
  // problem in any of them should cost that one tab rather than the page.
  const commission: ManagerCommission[] = await listProfiles()
    .then(getCommissionByManager)
    .catch((err) => {
      console.error("Commission failed to load:", err);
      return [];
    });

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
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
      <PageTabs
        tabs={[
          {
            key: "money",
            label: "Money",
            content: (
              <PaymentsDashboard
                data={data}
                canSeeOverhead={!!profile?.roles.includes("overhead")}
                commission={commission}
              />
            ),
          },
          // Hours are money: this is what the day cost in wages, and the only
          // honest input to what a job cost. Admin only — correcting a logged
          // time is not something the person who logged it should do.
          {
            key: "time",
            label: "Time & pay",
            content: isAdmin ? await TimeTab(searchParams) : null,
            visible: isAdmin,
          },
        ]}
      />
    </div>
  );
}

/** Who was on what today, and what it cost. */
async function TimeTab(searchParams: Promise<{ day?: string }>) {
  const { day: requested } = await searchParams;
  // A date somebody typed into the URL should not take the page down.
  const day = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : localDayKey();

  const [entries, people] = await Promise.all([
    listDayEntries(day).catch(() => []),
    listPayPeople().catch(() => []),
  ]);

  return <Timesheet entries={entries} people={people} day={day} />;
}
