import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile, listRoles } from "@/lib/data/team";
import { listRolePermissions } from "@/lib/data/permissions";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { PermissionsMatrix } from "@/components/permissions/permissions-matrix";

// Gated on the "admin" role directly (not the role_permissions table this
// page manages) so a misconfiguration here can never lock an admin out.
export default async function PermissionsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const profile = await getCurrentProfile();
  if (!profile?.roles.includes("admin")) {
    redirect("/attractors");
  }

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
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-bold">Permissions</h1>
        <p className="rounded-lg border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
          This page needs its database migration run first. In Supabase&apos;s SQL Editor, run{" "}
          <code>supabase/migrations/0028_role_permissions.sql</code>, then reload this page.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Permissions</h1>
      <p className="mb-6 text-muted-foreground">
        Which pages each role can see, including Admin — uncheck anything to see what a restricted
        view looks like. This page itself always stays reachable to Admins no matter what&apos;s
        checked here, so you can&apos;t lock yourself out.
      </p>
      <p className="mb-6 text-sm text-muted-foreground">
        New pages show up here on their own, marked <strong>new</strong> until somebody ticks or
        unticks a box for them. Until then each one falls back to the default under its name — most
        are admin-only, and the ones that were already open to the whole team stay that way.
      </p>
      <PermissionsMatrix roles={roles} permissions={permissions} />
    </div>
  );
}
