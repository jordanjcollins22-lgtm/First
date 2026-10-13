import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { getCurrentProfile } from "@/lib/data/team";
import { createClient } from "@/lib/supabase/server";
import { getActiveSnowRoute } from "@/lib/data/snow-ops";
import { canRunJobs, hasRole } from "@/lib/roles";
import { SnowStopLogger } from "@/components/snow/snow-stop-logger";

/**
 * Snow route: the crew's screen during a storm.
 *
 * Nothing on it when no storm is running, which is most of the year. When
 * one is, it is the route in order with the next stop open.
 */
export const dynamic = "force-dynamic";

export default async function SnowRoutePage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const me = await getCurrentProfile();
  if (!me) redirect("/login");
  if (!canRunJobs(me.roles) && !hasRole(me.roles, "project-technician")) redirect("/my-day");

  const route = await getActiveSnowRoute(await createClient()).catch(() => null);

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-6">
      {route ? (
        <SnowStopLogger event={{ id: route.event.id, label: route.event.label }} stops={route.stops} defaultService={route.event.service} />
      ) : (
        <div className="rounded-xl border bg-card p-4">
          <h1 className="text-lg font-bold">Snow route</h1>
          <p className="mt-1 text-sm text-muted-foreground">No storm is running. When one starts, the route shows up here in the order to drive it.</p>
        </div>
      )}
    </div>
  );
}
