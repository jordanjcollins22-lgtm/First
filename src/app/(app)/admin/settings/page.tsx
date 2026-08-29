import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile, listRoles } from "@/lib/data/team";
import { listRolePermissions } from "@/lib/data/permissions";
import { checkSchema, type MigrationStatus } from "@/lib/data/schema-check";
import { PaymentReadiness } from "@/components/admin/payment-readiness";
import { env, isStripeConfigured } from "@/lib/env";
import { listOrganizations } from "@/lib/data/organizations";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { PageTabs } from "@/components/ui/page-tabs";
import { PermissionsMatrix } from "@/components/permissions/permissions-matrix";
import { MigrationRunner } from "@/components/admin/migration-runner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateOrganizationForm } from "@/components/organizations/create-organization-form";
import { getEmailSetup } from "@/lib/data/email-setup";
import { EmailSetupPanel } from "@/components/admin/email-setup-panel";

const SUPERADMIN_EMAIL = "jordan@jslandscapingmd.com";

/**
 * The settings that keep the app running, on one page.
 *
 * Permissions, database setup and organizations were three nav entries
 * nobody visits weekly and everybody has to hunt for when they do. Folding
 * them together does not soften any of their gates: the page is admin-only,
 * and Organizations still checks one exact address, so it is simply not
 * there for anybody else.
 *
 * Gated on the admin role directly rather than on a permissions tab — the
 * tab list lives in the database these tabs exist to repair, and a page that
 * could be locked away by the thing it fixes is a trap.
 */
export default async function SettingsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const profile = await getCurrentProfile();
  if (!profile?.roles.includes("admin")) redirect("/attractors");

  const isSuperadmin = profile.email.toLowerCase() === SUPERADMIN_EMAIL;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <h1 className="mb-1 text-2xl font-bold">Settings</h1>
      <p className="mb-6 text-muted-foreground">
        Who can see what, what the database still needs, and the businesses running on this app.
      </p>

      <PageTabs
        tabs={[
          { key: "permissions", label: "Permissions", content: await PermissionsTab() },
          { key: "email", label: "Email", content: await EmailTab() },
          { key: "database", label: "Database", content: await DatabaseTab() },
          {
            key: "organizations",
            label: "Organizations",
            content: isSuperadmin ? await OrganizationsTab() : null,
            visible: isSuperadmin,
          },
        ]}
      />
    </div>
  );
}

async function PermissionsTab() {
  let roles: Awaited<ReturnType<typeof listRoles>> = [];
  let permissions: Awaited<ReturnType<typeof listRolePermissions>> = [];
  let migrationMissing = false;
  try {
    [roles, permissions] = await Promise.all([listRoles(), listRolePermissions()]);
  } catch {
    migrationMissing = true;
  }

  if (migrationMissing) {
    return (
      <p className="rounded-lg border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
        This needs its database migration run first. In Supabase&apos;s SQL Editor, run{" "}
        <code>supabase/migrations/0028_role_permissions.sql</code>, then reload.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-6 text-muted-foreground">
        Which pages each role can see, including Admin — uncheck anything to see what a restricted
        view looks like. Settings itself always stays reachable to Admins no matter what&apos;s
        checked here, so you can&apos;t lock yourself out.
      </p>
      <p className="mb-6 text-sm text-muted-foreground">
        New pages show up here on their own, marked <strong>undecided</strong> until somebody ticks a
        box for them. Nothing is open to the team on its own — an undecided page is visible to Admins
        only, so it stays reachable by whoever has to make the call without being handed to everyone.
        Use <strong>Open to all</strong> to give a page to every role in one tap.
      </p>
      <PermissionsMatrix roles={roles} permissions={permissions} />
    </div>
  );
}

async function DatabaseTab() {
  const migrations = await checkSchema().catch(() => []);

  // Pulled from the project URL, so the editor link goes to the right project
  // without anybody configuring a second setting.
  const projectRef =
    /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")?.[1] ?? null;

  return (
    <div className="max-w-md">
      <p className="mb-4 text-sm text-muted-foreground">
        Migrations are applied by hand in Supabase. This shows which ones are still outstanding and
        hands you the SQL.
      </p>

      <PaymentReadiness
        columnsApplied={paymentColumnsApplied(migrations)}
        hasStripeKey={isStripeConfigured}
        hasPublishableKey={Boolean(env.stripePublishableKey)}
        hasWebhookSecret={Boolean(env.stripeWebhookSecret)}
      />

      {migrations.length === 0 ? (
        <p className="rounded-lg border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
          Couldn&apos;t check the schema. Make sure Supabase is reachable and reload.
        </p>
      ) : (
        <MigrationRunner migrations={migrations} projectRef={projectRef} />
      )}
    </div>
  );
}

/**
 * Whether the columns a client's payment writes to are actually there.
 *
 * Read off the same probe the list uses rather than checked again, so the
 * summary at the top can never disagree with the rows underneath it.
 */
function paymentColumnsApplied(migrations: MigrationStatus[]): boolean | null {
  const needed = ["0124_acceptance_payment_path.sql", "0125_client_chosen_day.sql"];
  const rows = migrations.filter((m) => needed.includes(m.file));
  // Nothing to go on — the schema check itself failed.
  if (rows.length < needed.length) return null;
  return rows.every((m) => m.applied);
}

async function OrganizationsTab() {
  let organizations: Awaited<ReturnType<typeof listOrganizations>> = [];
  let loadError: string | null = null;
  try {
    organizations = await listOrganizations();
  } catch {
    loadError =
      "Couldn't load businesses — the database migration for this feature hasn't been run yet. Paste supabase/migrations/0034_multi_tenant_organizations.sql into Supabase's SQL editor and run it, then reload this page.";
  }

  return (
    <div className="max-w-3xl">
      <p className="mb-6 text-muted-foreground">
        Every separate business running on this app. Each one is fully isolated — its own customers,
        jobs, tools, pricing, and overhead, with no connection to any other.
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

/**
 * Who we send email as.
 *
 * Loaded on its own: this reads two tables that only exist after 0120, and a
 * fresh setup should lose this tab rather than the whole settings page.
 */
async function EmailTab() {
  const setup = await getEmailSetup().catch((err) => {
    console.error("Email setup failed to load:", err);
    return null;
  });

  if (!setup) {
    return (
      <p className="rounded-lg border border-border bg-card/60 px-3 py-3 text-sm text-muted-foreground">
        Couldn&apos;t load email settings. If this is a fresh setup, run{" "}
        <code>supabase/migrations/0120_email_sending.sql</code>.
      </p>
    );
  }

  return (
    <div className="max-w-2xl">
      <h2 className="mb-1 text-lg font-bold">Email</h2>
      <EmailSetupPanel setup={setup} />
    </div>
  );
}
