import { redirect } from "next/navigation";

import { listProfiles, listRoles, getCurrentProfile } from "@/lib/data/team";
import { listServicePricing } from "@/lib/data/service-pricing";
import { checkTabAccess } from "@/lib/data/access";
import { isSupabaseConfigured, isSupabaseAdminConfigured } from "@/lib/env";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { RoleCheckboxes } from "@/components/team/role-checkboxes";
import { CreateTeamMemberForm } from "@/components/team/create-team-member-form";
import { ResetPasswordControl } from "@/components/team/reset-password-control";
import { ManageRoles } from "@/components/team/manage-roles";
import { TeamServicesToggle } from "@/components/team/team-services-toggle";
import { ServicePricingRow } from "@/components/service-pricing/service-pricing-row";
import { CreateServiceTypeForm } from "@/components/service-pricing/create-service-type-form";
import { PendingServiceRow } from "@/components/service-pricing/pending-service-row";
import type { CustomRole, Profile } from "@/types/domain";

export default async function TeamServicesPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const [{ allowed: teamAllowed }, { allowed: servicesAllowed }] = await Promise.all([
    checkTabAccess("team"),
    checkTabAccess("services"),
  ]);
  if (!teamAllowed && !servicesAllowed) redirect("/attractors");

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

  const isAdmin = currentProfile?.roles.includes("admin") ?? false;
  const emailByProfileId = new Map(profiles.map((p) => [p.id, p.email]));

  const services = servicesAllowed ? await listServicePricing() : [];
  const activeServices = services.filter((s) => s.status === "active");
  const pendingServices = services.filter((s) => s.status === "pending");
  const deniedServices = services.filter((s) => s.status === "denied");

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Team &amp; Services</h1>
      <p className="mb-6 text-muted-foreground">Your people and the services you quote.</p>

      <TeamServicesToggle
        showTeam={teamAllowed}
        showServices={servicesAllowed}
        teamContent={
          <>
            {!isAdmin && (
              <p className="mb-6 rounded-lg border border-white/60 bg-card/60 px-3 py-2 text-xs text-muted-foreground backdrop-blur-md">
                If this should be an admin account, run this in Supabase&apos;s SQL Editor (swap in your
                email), then reload this page:{" "}
                <code>
                  insert into profile_roles (profile_id, role_name) select id, &apos;admin&apos; from profiles where
                  email = &apos;you@example.com&apos;;
                </code>
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
                            <RoleCheckboxes
                              profileId={profile.id}
                              initialRoles={profile.roles}
                              roles={roles}
                              disabled={profile.id === currentProfile?.id}
                            />
                          ) : (
                            <span className="capitalize">{profile.roles.join(", ") || "—"}</span>
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
          </>
        }
        servicesContent={
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              Every service you quote, with its cost and time estimate. Team members can propose a new one
              mid-quote — it shows up below as Pending until you price it or decline it.
            </p>

            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Add a service</CardTitle>
              </CardHeader>
              <CardContent>
                <CreateServiceTypeForm />
              </CardContent>
            </Card>

            {pendingServices.length > 0 && (
              <Card className="mb-6 border-amber-500/40">
                <CardHeader>
                  <CardTitle>Pending review ({pendingServices.length})</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col">
                  {pendingServices.map((s) => (
                    <PendingServiceRow
                      key={s.service_type_id}
                      serviceTypeId={s.service_type_id}
                      name={s.name}
                      requestedByEmail={s.requested_by ? emailByProfileId.get(s.requested_by) ?? null : null}
                      requestedNote={s.requested_note}
                    />
                  ))}
                </CardContent>
              </Card>
            )}

            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Services</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col">
                {activeServices.map((s) => (
                  <ServicePricingRow
                    key={s.service_type_id}
                    serviceTypeId={s.service_type_id}
                    label={s.name}
                    initialCogs={s.cogs}
                    initialCost={s.cost}
                    initialCostUnit={s.cost_unit}
                    initialEstimatedHours={s.estimated_hours}
                  />
                ))}
                {activeServices.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No services yet — add one above, or wait for a team member to propose one.
                  </p>
                )}
              </CardContent>
            </Card>

            {deniedServices.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Declined</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1">
                  {deniedServices.map((s) => (
                    <p key={s.service_type_id} className="text-sm text-muted-foreground">
                      {s.name} — outside our scope of work
                    </p>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        }
      />
    </div>
  );
}
