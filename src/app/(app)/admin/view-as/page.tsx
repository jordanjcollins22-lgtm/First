import Link from "next/link";
import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getRealProfile, listProfiles } from "@/lib/data/team";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ViewAsPicker } from "@/components/team/view-as-picker";
import { BackLink } from "@/components/ui/back-link";

/**
 * See the app as somebody else on the team.
 *
 * Gated on the account that is actually signed in, not the one being
 * viewed as, so an admin already looking through a crew member's eyes can
 * come here and switch to the next person without going back first.
 */
export const dynamic = "force-dynamic";

const ROLE_PREVIEWS: [string, string][] = [
  ["account-manager", "Account manager"],
  ["technician", "Technician"],
  ["affiliate", "Affiliate"],
  ["partner", "Location partner"],
];

export default async function ViewAsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const real = await getRealProfile();
  if (!real?.roles.includes("admin")) redirect("/me");

  const profiles = await listProfiles().catch(() => []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
      <div className="mb-3"><BackLink fallbackHref="/me" /></div>
      <h1 className="mb-1 text-2xl font-bold">View as</h1>
      <p className="mb-6 text-muted-foreground">
        Pick someone and the whole app becomes what they see: their tabs, their day, their jobs. A
        banner stays at the top until you return to your own account.
      </p>
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Each role&apos;s screen</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">The home screen each role gets, filled with your own numbers.</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {ROLE_PREVIEWS.map(([key, label]) => (
              <li key={key}>
                <Link
                  href={`/me?role=${key}`}
                  className="flex min-h-12 items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
                >
                  {label}
                  <span className="text-xs font-semibold text-primary">Open</span>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Team</CardTitle>
        </CardHeader>
        <CardContent>
          <ViewAsPicker profiles={profiles} selfId={real.id} />
        </CardContent>
      </Card>
    </div>
  );
}
