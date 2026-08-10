import { listProfiles, listRoles, getCurrentProfile } from "@/lib/data/team";
import { isSupabaseConfigured, isSupabaseAdminConfigured } from "@/lib/env";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { RoleSelect } from "@/components/team/role-select";
import { CreateTeamMemberForm } from "@/components/team/create-team-member-form";
import { ResetPasswordControl } from "@/components/team/reset-password-control";
import { ManageRoles } from "@/components/team/manage-roles";
import type { CustomRole, Profile } from "@/types/domain";

export default async function TeamPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  let profiles: Profile[] = [];
  let roles: CustomRole[] = [];
  let currentProfile: Profile | null = null;
  let migrationMissing = false;
  try {
    [profiles, roles, currentProfile] = await Promise.all([listProfiles(), listRoles(), getCurrentProfile()]);
  } catch {
    migrationMissing = true;
  }

  if (migrationMissing) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-bold">Team</h1>
        <p className="rounded-lg border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
          This page needs its database migrations run first. In Supabase&apos;s SQL Editor, run{" "}
          <code>supabase/migrations/0019_roles_and_assignment.sql</code> and{" "}
          <code>supabase/migrations/0020_custom_roles.sql</code> (in that order), then reload this
          page.
        </p>
      </div>
    );
  }

  const isAdmin = currentProfile?.role === "admin";

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Team</h1>
      <p className="mb-6 text-muted-foreground">
        Everyone with an account and their role. {isAdmin
          ? "Jobs can be assigned to a team member from the Properties page."
          : "Your account isn't an admin, so roles here are read-only and you won't see the controls to add people or set passwords."}
      </p>

      {!isAdmin && (
        <p className="mb-6 rounded-lg border border-white/60 bg-card/60 px-3 py-2 text-xs text-muted-foreground backdrop-blur-md">
          If this should be an admin account, run this in Supabase&apos;s SQL Editor (swap in your
          email), then reload this page:{" "}
          <code>update profiles set role = &apos;admin&apos; where email = &apos;you@example.com&apos;;</code>
        </p>
      )}

      {isAdmin && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Roles</CardTitle>
          </CardHeader>
          <CardContent>
            <ManageRoles roles={roles} />
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Add a team member</CardTitle>
          </CardHeader>
          <CardContent>
            {isSupabaseAdminConfigured ? (
              <CreateTeamMemberForm roles={roles} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Add <code>SUPABASE_SERVICE_ROLE_KEY</code> to <code>.env.local</code> (from your
                Supabase project&apos;s API settings) and restart the server to create accounts
                from here.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-2 font-medium">Email</th>
                <th className="p-2 font-medium">Role</th>
                {isAdmin && isSupabaseAdminConfigured && <th className="p-2 font-medium">Password</th>}
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.id} className="border-b border-border align-middle">
                  <td className="p-2">
                    <p className="font-medium">{profile.full_name || profile.email}</p>
                    {profile.full_name && <p className="text-xs text-muted-foreground">{profile.email}</p>}
                  </td>
                  <td className="p-2">
                    {isAdmin ? (
                      <RoleSelect
                        profileId={profile.id}
                        initialRole={profile.role}
                        roles={roles}
                        disabled={profile.id === currentProfile?.id}
                      />
                    ) : (
                      <span className="capitalize">{profile.role}</span>
                    )}
                  </td>
                  {isAdmin && isSupabaseAdminConfigured && (
                    <td className="p-2">
                      <ResetPasswordControl profileId={profile.id} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {profiles.length === 0 && <p className="p-4 text-sm text-muted-foreground">No accounts yet.</p>}
      </Card>

      {isAdmin && (
        <p className="mt-3 text-xs text-muted-foreground">
          You can&apos;t change your own role here — ask another admin, or update it directly in
          Supabase.
        </p>
      )}
    </div>
  );
}
