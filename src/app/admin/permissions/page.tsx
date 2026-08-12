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

  const [roles, permissions] = await Promise.all([listRoles(), listRolePermissions()]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Permissions</h1>
      <p className="mb-6 text-muted-foreground">
        Which tabs each role can see. A person sees a tab if any of their roles grants it here.
      </p>
      <PermissionsMatrix roles={roles} permissions={permissions} />
    </div>
  );
}
