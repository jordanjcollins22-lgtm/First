import { listProfiles, getCurrentProfile } from "@/lib/data/team";
import { isSupabaseConfigured } from "@/lib/env";
import { Card } from "@/components/ui/card";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { RoleSelect } from "@/components/team/role-select";

export default async function TeamPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const [profiles, currentProfile] = await Promise.all([listProfiles(), getCurrentProfile()]);
  const isAdmin = currentProfile?.role === "admin";

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Team</h1>
      <p className="mb-6 text-muted-foreground">
        Everyone with an account and their role. {isAdmin
          ? "Jobs can be assigned to a team member from the Properties page."
          : "Only admins can change roles."}
      </p>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-2 font-medium">Email</th>
                <th className="p-2 font-medium">Role</th>
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
                        disabled={profile.id === currentProfile?.id}
                      />
                    ) : (
                      <span className="capitalize">{profile.role}</span>
                    )}
                  </td>
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
