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
import { getReceivedPayments } from "@/lib/data/received-payments";
import { ReceivedPanel } from "@/components/payments/received-panel";
import { TransactionImportPanel } from "@/components/payments/transaction-import-panel";
import { listPlans } from "@/lib/data/payment-plans";
import { SchedulesPanel } from "@/components/payments/schedules-panel";
import { RecordPaymentPanel } from "@/components/payments/record-payment-panel";

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
  if (!allowed) redirect("/my-day");

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
        <h1 className="mb-1 text-2xl font-bold">Money</h1>
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
        Everything in and out — cash jobs, team pay, materials and overhead. Invoices live on
        Proposals &amp; Invoices.
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
          // Money that arrived, and what we did for it. Separate from Money
          // above because that tab answers "how are we doing" and this one
          // answers "is every payment attached to the work it paid for" —
          // which is a list of things to fix, not a number to read.
          {
            key: "received",
            label: "Received",
            content: await ReceivedTab(),
          },
          // Who is paying us over time, and who is behind. Its own tab
          // because it is a chasing list rather than a total: what it answers
          // is who to ring today.
          {
            key: "schedules",
            label: "Schedules",
            content: await SchedulesTab(),
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

/**
 * Money in, gathered into the projects it paid for.
 *
 * Loaded on its own and allowed to fail on its own: it reads across payments,
 * contacts, jobs and properties, and a problem in any of them should cost
 * this tab rather than the whole Money page.
 */
async function ReceivedTab() {
  const data = await getReceivedPayments().catch((err) => {
    console.error("Received payments failed to load:", err);
    return null;
  });

  if (!data) {
    return (
      <p className="rounded-lg border border-border bg-card/60 px-3 py-3 text-sm text-muted-foreground">
        Couldn&apos;t load received payments. If this is a fresh setup, run{" "}
        <code>supabase/migrations/0116_payment_plans.sql</code>.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Money taken elsewhere, brought in and joined up. Above the list
          rather than behind a tab: it is the thing somebody came here to do
          the first few times, and invisible once the backlog is in. */}
      <TransactionImportPanel />
      {/* Cash on the driveway and cheques in the post come through neither
          the card processor nor an export, so without this they exist only
          in somebody's memory. Folded shut until it is wanted. */}
      <RecordPaymentPanel />
      <ReceivedPanel data={data} />
    </div>
  );
}

/**
 * Payment schedules across the whole book.
 *
 * Loaded on its own and allowed to fail on its own, like its neighbours: it
 * reads plans, instalments and payments, and a problem in any of them should
 * cost this tab rather than the page.
 */
async function SchedulesTab() {
  const plans = await listPlans().catch((err) => {
    console.error("Payment schedules failed to load:", err);
    return null;
  });

  if (!plans) {
    return (
      <p className="rounded-lg border border-border bg-card/60 px-3 py-3 text-sm text-muted-foreground">
        Couldn&apos;t load payment schedules. If this is a fresh setup, run{" "}
        <code>supabase/migrations/0116_payment_plans.sql</code>.
      </p>
    );
  }

  return <SchedulesPanel plans={plans} />;
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
