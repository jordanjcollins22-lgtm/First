import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { getFleetBoard } from "@/lib/data/fleet";
import { FleetBoardView } from "@/components/fleet/fleet-board";

/**
 * Fleet.
 *
 * One truck and two trailers, all old, and no crew gets to a job without them.
 * That is the largest single risk this business carries and nothing recorded
 * it, which meant it was argued about rather than measured.
 *
 * The page turns it into two numbers. The chance of being stranded, which
 * rises every day by itself; and what another week of waiting is expected to
 * cost, which is the only form of that risk anybody can weigh against a
 * deposit.
 *
 * Both are estimates and are labelled as estimates. They are built from age,
 * miles, an honest opinion of the condition, and what has already gone wrong,
 * and they are worth what those are worth. A rough number that gets looked at
 * beats a precise one nobody has.
 */
export const dynamic = "force-dynamic";

export default async function FleetPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("fleet", "/more");

  const board = await getFleetBoard().catch((err) => {
    console.error("Fleet failed to load:", err);
    return null;
  });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">Fleet</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What the crew depends on, how likely each thing is to strand them, and when the money is
          there for the next one. The odds are an estimate from age, miles, condition and what has
          already broken. Record a breakdown the day it happens and everything here gets sharper.
        </p>
      </header>

      {board ? (
        <FleetBoardView board={board} />
      ) : (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          Couldn&apos;t load the fleet just now. Reload the page.
        </p>
      )}
    </div>
  );
}
