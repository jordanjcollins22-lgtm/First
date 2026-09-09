import { notFound, redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { getCurrentProfile } from "@/lib/data/team";
import { playRoute } from "@/lib/data/play-route";
import { RouteWalker } from "@/components/marketing/route-walker";

/**
 * Walking one door-hanger round.
 *
 * Reached from My Day by whoever the round belongs to. Not tab-gated: it shows
 * one person the work they have been given, in a street, on a phone — and a
 * tick somebody forgot to grant is the difference between a round getting
 * walked and somebody standing on a kerb looking at a refusal.
 *
 * It is still gated: signed in, in this business, and the round is theirs or
 * they run the business.
 */
export const dynamic = "force-dynamic";

export default async function RoutePage({ params }: { params: Promise<{ playId: string }> }) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { playId } = await params;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const route = await playRoute(playId).catch(() => null);
  if (!route || route.doors.length === 0) notFound();

  return (
    <RouteWalker
      playId={playId}
      zoneName={route.zoneName}
      mode={route.mode}
      doors={route.doors}
      park={route.park}
      walked={route.walked}
    />
  );
}
