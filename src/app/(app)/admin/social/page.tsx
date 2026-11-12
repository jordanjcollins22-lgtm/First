import { redirect } from "next/navigation";

import { env, isSupabaseConfigured } from "@/lib/env";
import { publishTargets } from "@/lib/social/facebook";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { loadPostingStatus } from "@/lib/data/social-autopost";
import { SocialAutopostPanel } from "@/components/marketing/social-autopost-panel";
import { SEED_DRAFTS } from "@/lib/social/seed-drafts";
import { checkTabAccess } from "@/lib/data/access";
import {
  listJobsMissingBeforeAfter,
  listPostCandidates,
  listSocialPosts,
} from "@/lib/data/social";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { SocialStudio } from "@/components/marketing/social-studio";
import { WeekPlan } from "@/components/marketing/week-plan";
import { listPlanPosts } from "@/lib/data/social-plan";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { weekStart } from "@/lib/social-plan";

export default async function SocialPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { allowed } = await checkTabAccess("social");
  if (!allowed) redirect("/dashboard");

  const organizationId = await getCurrentOrganizationId();
  const [candidates, posts, missing, plan, targets, profile, client] = await Promise.all([
    listPostCandidates().catch(() => []),
    listSocialPosts().catch(() => []),
    listJobsMissingBeforeAfter().catch(() => []),
    listPlanPosts(organizationId, weekStart(new Date())).catch((err) => {
      console.error("Planned posts failed to load:", err);
      return [];
    }),
    publishTargets(organizationId).catch(() => ({ facebook: false, instagram: false })),
    getCurrentProfile(),
    createClient(),
  ]);
  const status = await loadPostingStatus({ client, organizationId }, targets);
  const canManage = Boolean(profile && (isOwnerLevel(profile.roles) || profile.roles.includes("admin")));

  const publishesTo = [
    ...(targets.facebook ? ["Facebook"] : []),
    ...(targets.instagram ? ["Instagram"] : []),
    ...(env.socialWebhookUrl ? ["the posting hand-off"] : []),
  ];
  return (
    <>
      <SocialAutopostPanel
        health={status.health}
        cadence={status.cadence.cadence}
        cadenceReady={status.cadence.ready}
        upcoming={status.upcoming}
        canManage={canManage}
        seedCount={SEED_DRAFTS.length}
      />
      <WeekPlan posts={plan} publishesTo={publishesTo} />
      <SocialStudio candidates={candidates} posts={posts} missing={missing} publishesTo={publishesTo} />
    </>
  );
}
