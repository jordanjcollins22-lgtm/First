import { redirect } from "next/navigation";

import { listProfiles, listRoles, getCurrentProfile } from "@/lib/data/team";
import { listServicePricing } from "@/lib/data/service-pricing";
import { listMaterials } from "@/lib/data/materials";
import { listTools } from "@/lib/data/tools";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { checkTabAccess } from "@/lib/data/access";
import { createClient } from "@/lib/supabase/server";
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
import { PayRateInput } from "@/components/team/pay-rate-input";
import { PhoneInput } from "@/components/team/phone-input";
import { MeasurementUnitSetting } from "@/components/service-pricing/measurement-unit-setting";
import { startImpersonation } from "@/lib/actions/impersonation-actions";
import type {
  CustomRole,
  MeasurementBasis,
  Profile,
  ServiceMaterialRule,
  ServiceToolLink,
  Tool,
} from "@/types/domain";

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

  // Grouped by role, in the roles table's own order. Someone holding several
  // roles shows under each one; anybody with none lands in "No role yet".
  const groups: { role: string; members: Profile[] }[] = roles
    .map((r) => ({ role: r.name, members: profiles.filter((p) => p.roles.includes(r.name)) }))
    .filter((g) => g.members.length > 0);
  const unassigned = profiles.filter((p) => p.roles.length === 0);
  if (unassigned.length > 0) groups.push({ role: "No role yet", members: unassigned });

  const teamColumnCount = 2 + (isAdmin ? 3 : 0) + (isAdmin && isSupabaseAdminConfigured ? 1 : 0);

  let services: Awaited<ReturnType<typeof listServicePricing>> = [];
  let materials: Awaited<ReturnType<typeof listMaterials>> = [];
  let materialRules: ServiceMaterialRule[] = [];
  let tools: Tool[] = [];
  let serviceTools: ServiceToolLink[] = [];
  let crewCostPerHour: number | null = null;
  let measurementUnit = "sq ft";
  let measurementBasis: MeasurementBasis = "area";
  if (servicesAllowed) {
    const supabase = await createClient();
    const [servicesRes, materialsRes, toolsRes, rulesRes, serviceToolsRes, orgRes] = await Promise.all([
      listServicePricing(),
      listMaterials(),
      listTools(),
      supabase.from("service_materials").select("*"),
      supabase.from("service_tools").select("*"),
      getCurrentOrganization(),
    ]);
    services = servicesRes;
    materials = materialsRes;
    tools = toolsRes;
    materialRules = (rulesRes.data ?? []) as unknown as ServiceMaterialRule[];
    serviceTools = (serviceToolsRes.data ?? []) as unknown as ServiceToolLink[];
    measurementUnit = orgRes.measurement_unit || "sq ft";
    measurementBasis =
      orgRes.measurement_basis === "perimeter" || orgRes.measurement_basis === "flat"
        ? orgRes.measurement_basis
        : "area";

    // Blended crew cost = average of the HOURLY team's set pay rates —
    // commission pay is a % of the sale, not a per-hour labor cost. The
    // org-level manual rate only fills in until pay has been entered.
    const payRates = profiles
      .filter((p) => p.pay_type !== "commission")
      .map((p) => p.pay_rate_per_hour)
      .filter((r): r is number => r != null);
    crewCostPerHour =
      payRates.length > 0
        ? Math.round((payRates.reduce((sum, r) => sum + r, 0) / payRates.length) * 100) / 100
        : orgRes.crew_cost_per_hour;
  }
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
                      {isAdmin && <th className="p-2 font-medium">Pay</th>}
                      {isAdmin && <th className="p-2 font-medium">Phone</th>}
                      {isAdmin && isSupabaseAdminConfigured && <th className="p-2 font-medium">Password</th>}
                      {isAdmin && <th className="p-2 font-medium">Account</th>}
                    </tr>
                  </thead>
                  {groups.map((group) => (
                  <tbody key={group.role}>
                    <tr className="border-b border-border bg-muted/40">
                      <td colSpan={teamColumnCount} className="px-2 py-1.5">
                        <span className="text-xs font-semibold uppercase tracking-wide capitalize">
                          {group.role}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {group.members.length} {group.members.length === 1 ? "person" : "people"}
                        </span>
                      </td>
                    </tr>
                    {group.members.map((profile) => (
                      <tr key={`${group.role}-${profile.id}`} className="border-b border-border align-middle">
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
                        {isAdmin && (
                          <td className="p-2">
                            <PayRateInput
                              profileId={profile.id}
                              initialPayType={
                                profile.pay_type === "commission" || profile.pay_type === "both"
                                  ? profile.pay_type
                                  : "hourly"
                              }
                              initialRate={profile.pay_rate_per_hour}
                              initialCommissionPct={profile.commission_pct}
                            />
                          </td>
                        )}
                        {isAdmin && (
                          <td className="p-2">
                            <PhoneInput profileId={profile.id} initialPhone={profile.phone} />
                          </td>
                        )}
                        {isAdmin && isSupabaseAdminConfigured && (
                          <td className="p-2">
                            <ResetPasswordControl profileId={profile.id} />
                          </td>
                        )}
                        {isAdmin && (
                          <td className="p-2">
                            {profile.id !== currentProfile?.id && (
                              <form action={startImpersonation.bind(null, profile.id)}>
                                <button type="submit" className="text-xs text-primary underline-offset-2 hover:underline">
                                  View as
                                </button>
                              </form>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  ))}
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

            <div className="mb-6 flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
              {isAdmin && (
                <MeasurementUnitSetting initialUnit={measurementUnit} initialBasis={measurementBasis} />
              )}
              {crewCostPerHour != null ? (
                <p>
                  Crew cost per hour: <span className="font-semibold">${crewCostPerHour.toFixed(2)}</span>
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    — the average of the hourly pay rates set on the Team side (commission-based people
                    aren&apos;t counted). Update pay there and this follows.
                  </span>
                </p>
              ) : (
                <p className="text-xs text-destructive">
                  No crew cost per hour yet — set hourly pay for your crew on the Team side so labor cost can
                  be calculated.
                </p>
              )}
            </div>

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
                    initialMinutesPerSqft={s.minutes_per_sqft}
                    initialCrewSize={s.crew_size ?? 1}
                    initialHowTo={s.how_to}
                    materials={materials}
                    materialRules={materialRules}
                    tools={tools}
                    serviceTools={serviceTools}
                    crewCostPerHour={crewCostPerHour}
                    measurementUnit={measurementUnit}
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
