import { getCurrentProfile } from "@/lib/data/team";
import { OperationsHome } from "@/components/v2/panels/role/operations-home";

/**
 * The project lead's home screen in the new layout: the crew's day, with
 * their crew under it. Who's here and who's late, hours left on each job's
 * budget, the materials and whether they're on the truck, issues to raise,
 * and the final walkthrough and sign-off.
 *
 * Drawn as whoever is being previewed, so the owner sees exactly this.
 */
export async function LeadHomePanel() {
  const profile = await getCurrentProfile();
  if (!profile) return <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">Sign in to see your day.</p>;
  return <OperationsHome profile={profile} lead />;
}
