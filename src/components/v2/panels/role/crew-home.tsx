import { getCurrentProfile } from "@/lib/data/team";
import { OperationsHome } from "@/components/v2/panels/role/operations-home";

/**
 * The crew's home screen in the new layout: their whole working day on one
 * phone screen. Clock in, the shop's load-out, the one button for the next
 * step (at the shop, leaving, on my way, arrived, finished here, back at the
 * shop), the job sheet with its areas and photos, a way to report a problem,
 * the machines' hours at the end of the day, and what is next. A storm puts
 * the snow route on top; a day with nothing booked says so and shows the
 * next one.
 *
 * Drawn as whoever is being previewed, so the owner sees exactly this.
 */
export async function CrewHomePanel() {
  const profile = await getCurrentProfile();
  if (!profile) return <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">Sign in to see your day.</p>;
  return <OperationsHome profile={profile} lead={false} />;
}
