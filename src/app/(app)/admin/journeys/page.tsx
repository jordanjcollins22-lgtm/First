import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { listJourneys, listJourneySteps } from "@/lib/data/journeys";
import { syncCodeManagedJourneys } from "@/lib/journeys/sync";
import { CODE_MANAGED_ROLE_KEYS } from "@/lib/journeys/definitions";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { JourneyDashboard } from "@/components/journeys/journey-dashboard";

// Gated on the "admin" role directly, same as Permissions and Organizations
// — this page shows how every role moves through the system, which is
// exactly the kind of thing that shouldn't be reachable by a misconfigured
// tab permission.
export default async function JourneysPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const profile = await getCurrentProfile();
  if (!profile?.roles.includes("admin")) {
    redirect("/attractors");
  }

  const org = await getCurrentOrganization().catch(() => null);
  const orgName = org?.name ?? "the app";

  let journeys: Awaited<ReturnType<typeof listJourneys>> = [];
  let migrationMissing = false;
  try {
    // Evaluator/Client are code-defined — this brings the DB back in line
    // with the app every time an admin opens the dashboard, before reading.
    await syncCodeManagedJourneys();
    journeys = await listJourneys();
  } catch {
    migrationMissing = true;
  }

  if (migrationMissing) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-bold">Journey Dashboard</h1>
        <p className="rounded-lg border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
          This page needs its database migration run first. In Supabase&apos;s SQL Editor, run{" "}
          <code>supabase/migrations/0047_journey_dashboard.sql</code>, then reload this page.
        </p>
      </div>
    );
  }

  const stepsByJourney: Record<string, Awaited<ReturnType<typeof listJourneySteps>>> = {};
  await Promise.all(
    journeys.map(async (journey) => {
      stepsByJourney[journey.id] = await listJourneySteps(journey.id);
    })
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Journey Dashboard</h1>
      <p className="mb-6 text-muted-foreground">
        How every role moves through {orgName}, step by step — where the clicks go, what&apos;s automated
        already, and what still needs a human.
      </p>
      <JourneyDashboard
        journeys={journeys}
        stepsByJourney={stepsByJourney}
        codeManagedRoleKeys={Array.from(CODE_MANAGED_ROLE_KEYS)}
      />
    </div>
  );
}
