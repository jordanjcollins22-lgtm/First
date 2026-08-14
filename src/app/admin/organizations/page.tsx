import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { listOrganizations } from "@/lib/data/organizations";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateOrganizationForm } from "@/components/organizations/create-organization-form";

const SUPERADMIN_EMAIL = "jordan@jslandscapingmd.com";

// Gated purely on this exact email, independent of the tabs/role system —
// so it can never be locked out by a permissions misconfiguration, and no
// other admin (even in this same business) can reach it.
export default async function OrganizationsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const profile = await getCurrentProfile();
  if (!profile || profile.email.toLowerCase() !== SUPERADMIN_EMAIL) {
    redirect("/attractors");
  }

  const organizations = await listOrganizations();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Organizations</h1>
      <p className="mb-6 text-muted-foreground">
        Every separate business running on this app. Each one is fully isolated — its own customers, jobs,
        tools, pricing, and overhead, with no connection to any other.
      </p>

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
