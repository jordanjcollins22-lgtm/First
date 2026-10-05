import { redirect } from "next/navigation";

import { env, isFacebookConfigured, isSupabaseConfigured } from "@/lib/env";
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
  const [candidates, posts, missing, plan] = await Promise.all([
    listPostCandidates().catch(() => []),
    listSocialPosts().catch(() => []),
    listJobsMissingBeforeAfter().catch(() => []),
    listPlanPosts(organizationId, weekStart(new Date())).catch((err) => {
      console.error("Planned posts failed to load:", err);
      return [];
    }),
  ]);

  const publishesTo = [
    ...(isFacebookConfigured ? ["Facebook"] : []),
    ...(env.socialWebhookUrl ? ["the posting hand-off"] : []),
  ];
  return (
    <>
      <WeekPlan posts={plan} publishesTo={publishesTo} />
      <SocialStudio candidates={candidates} posts={posts} missing={missing} publishesTo={publishesTo} />
    </>
  );
}
