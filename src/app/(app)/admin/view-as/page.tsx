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

export default async function ViewAsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const real = await getRealProfile();
  if (!real?.roles.includes("admin")) redirect("/my-day");

  const profiles = await listProfiles().catch(() => []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
      <div className="mb-3"><BackLink fallbackHref="/admin" /></div>
      <h1 className="mb-1 text-2xl font-bold">View as</h1>
      <p className="mb-6 text-muted-foreground">
        Pick someone and the whole app becomes what they see: their tabs, their day, their jobs. A
        banner stays at the top until you return to your own account.
      </p>
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
