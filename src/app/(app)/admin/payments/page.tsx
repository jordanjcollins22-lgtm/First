import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { canManagePayroll, listPayablePeople, listTeamPayments } from "@/lib/data/team-payments";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { PaymentTracker } from "@/components/payments/payment-tracker";

export default async function PaymentsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const profile = await getCurrentProfile();
  if (!profile || !canManagePayroll(profile.roles)) {
    redirect("/attractors");
  }

  const [people, payments] = await Promise.all([listPayablePeople(), listTeamPayments()]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Payments</h1>
      <p className="mb-6 text-muted-foreground">
        What each team member has been paid and what&apos;s still owed. Recording a payment here logs it — it
        doesn&apos;t send money.
      </p>
      <PaymentTracker people={people} payments={payments} />
    </div>
  );
}
