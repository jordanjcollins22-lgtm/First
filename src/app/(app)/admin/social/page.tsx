import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { checkTabAccess } from "@/lib/data/access";
import {
  listJobsMissingBeforeAfter,
  listPostCandidates,
  listSocialPosts,
} from "@/lib/data/social";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { SocialStudio } from "@/components/marketing/social-studio";

export default async function SocialPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const { allowed } = await checkTabAccess("social");
  if (!allowed) redirect("/dashboard");

  const [candidates, posts, missing] = await Promise.all([
    listPostCandidates().catch(() => []),
    listSocialPosts().catch(() => []),
    listJobsMissingBeforeAfter().catch(() => []),
  ]);

  return <SocialStudio candidates={candidates} posts={posts} missing={missing} />;
}
