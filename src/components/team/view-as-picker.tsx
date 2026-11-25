import { startImpersonation } from "@/lib/actions/impersonation-actions";
import { meScreenFor, type MeScreen } from "@/lib/me-screen";
import type { Profile } from "@/types/domain";

const ROLE_NAME: Record<MeScreen, string> = {
  owner: "Owner",
  "account-manager": "Account manager",
  technician: "Technician",
  affiliate: "Affiliate",
  partner: "Location partner",
};
/** The role by the names we use now (old labels like crew or office aren't shown). */
const roleName = (p: Profile) => {
  const screen = meScreenFor(p);
  return screen ? ROLE_NAME[screen] : "No role yet";
};

/**
 * Everyone you can see the app as, one button each.
 *
 * Buttons rather than a table column: a column at the right of a wide
 * table is off the edge of a phone, and a feature that is off the edge of
 * a phone is a feature that has been taken away.
 */
export function ViewAsPicker({ profiles, selfId }: { profiles: Profile[]; selfId: string | null }) {
  // People with a role first, then the ones still waiting for one.
  const others = profiles
    .filter((p) => p.id !== selfId)
    .sort((a, b) => Number(!meScreenFor(a)) - Number(!meScreenFor(b)));
  if (others.length === 0) {
    return <p className="text-sm text-muted-foreground">Nobody else on the team yet.</p>;
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {others.map((p) => (
        <li key={p.id}>
          <form action={startImpersonation.bind(null, p.id)}>
            <button
              type="submit"
              className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2 text-left hover:bg-accent"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{p.full_name || p.email}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {roleName(p)}
                </span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-primary">View as</span>
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}
