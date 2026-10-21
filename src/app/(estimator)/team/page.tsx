import { AddTeamMemberForm } from "@/components/team/add-team-member-form";
import { TeamMemberCard } from "@/components/team/team-member-card";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listOpenJobs, listTeamMembers } from "@/lib/data/team";
import { isGhlConfigured, isSupabaseConfigured } from "@/lib/env";

export default async function TeamPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const [members, jobs] = await Promise.all([listTeamMembers(), listOpenJobs()]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Team</h1>
      <p className="mb-6 text-muted-foreground">
        Add each team member&apos;s mobile number and schedule their check-ins. Texts go out through
        GoHighLevel. When someone replies, the app matches the reply to that person by their number.
      </p>

      {!isGhlConfigured() && (
        <p className="mb-6 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm">
          GoHighLevel isn&apos;t connected yet. Set <code>GHL_API_KEY</code> and{" "}
          <code>GHL_LOCATION_ID</code> to start sending texts. You can add people and schedules in the
          meantime.
        </p>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Add a team member</CardTitle>
        </CardHeader>
        <CardContent>
          <AddTeamMemberForm />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        {members.map((member) => (
          <TeamMemberCard key={member.id} member={member} jobs={jobs} />
        ))}
      </div>
    </div>
  );
}
