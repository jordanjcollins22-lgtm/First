import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { listOrganizations } from "@/lib/data/organizations";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateOrganizationForm } from "@/components/organizations/create-organization-form";
import { requireTab } from "@/lib/data/access";

const SUPERADMIN_EMAIL = "jordan@jslandscapingmd.com";

// Gated purely on this exact email, independent of the tabs/role system —
// so it can never be locked out by a permissions misconfiguration, and no
// other admin (even in this same business) can reach it.
export default async function OrganizationsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("organizations", "/attractors");

  const profile = await getCurrentProfile();
  if (!profile || profile.email.toLowerCase() !== SUPERADMIN_EMAIL) {
    redirect("/attractors");
  }

  let organizations: Awaited<ReturnType<typeof listOrganizations>> = [];
  let loadError: string | null = null;
  try {
    organizations = await listOrganizations();
  } catch {
    loadError =
      "Couldn't load businesses — the database migration for this feature hasn't been run yet. Paste supabase/migrations/0034_multi_tenant_organizations.sql into Supabase's SQL editor and run it, then reload this page.";
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <h1 className="mb-1 text-2xl font-bold">Organizations</h1>
      <p className="mb-6 text-muted-foreground">
        Every separate business running on this app. Each one is fully isolated — its own customers, jobs,
        tools, pricing, and overhead, with no connection to any other.
      </p>

      {loadError && (
        <Card className="mb-6 border-destructive/50">
          <CardContent className="pt-6 text-sm text-destructive">{loadError}</CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Create a business</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateOrganizationForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All businesses</CardTitle>
        </CardHeader>
        <CardContent>
          {organizations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No businesses yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {organizations.map((org) => (
                <li key={org.id} className="rounded-md border border-border px-3 py-2 text-sm">
                  {org.name}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
