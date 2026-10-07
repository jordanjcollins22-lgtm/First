import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { isAccountManager } from "@/lib/affiliate-roles";
import { listProjectReviews } from "@/lib/data/project-review";
import { ProjectReviewCard } from "@/components/projects/project-review-card";

/**
 * Every project a client said yes to, scored: issues, hours, cost, a
 * five-star review, a referral and profit, each green or red, worked out
 * live from each job. The ones with something red come first.
 */
export const dynamic = "force-dynamic";

export default async function ProjectReviewPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin") && !isAccountManager(profile.roles)) redirect("/my-day");

  const rows = await listProjectReviews().catch((err) => {
    console.error("Project reviews failed to load:", err);
    return null;
  });
  const red = rows?.filter((r) => !r.review.allGood) ?? [];
  const green = rows?.filter((r) => r.review.allGood) ?? [];
  const changes = (rows ?? []).flatMap((r) =>
    r.issues.filter((i) => i.prevention?.trim()).map((i) => ({ id: i.id, prevention: i.prevention!, title: i.title, client: r.client }))
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">Project review</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every project, from the account manager&apos;s final sign-off, scored on the real cost entered then, and kept up to date after:
          a callback, a review, a referral. Green is good, red is not: any issue, over the hours or the cost, no five-star review, no
          referral, or under 50% profit.
        </p>
      </header>
      {rows == null ? (
        <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">The reviews couldn&apos;t load just now. Reload the page.</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">No projects yet. One lands here when the account manager signs it off.</p>
      ) : (
        <>
          <p className="text-sm">
            <span className="font-semibold text-red-700 dark:text-red-400">{red.length} with something red</span>
            <span className="text-muted-foreground"> · </span>
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">{green.length} all green</span>
          </p>
          {[...red, ...green].map((row) => (
            <ProjectReviewCard key={row.jobId} row={row} href={`/jobs/${row.jobId}`} />
          ))}
          {/* Every change made so an issue can't happen again, in one place: the rules the next job runs on. */}
          {changes.length > 0 && (
            <section className="rounded-2xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">What we changed so it can&apos;t happen again</h2>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                {changes.map((c) => (
                  <li key={c.id}>
                    <span className="font-medium">{c.prevention}</span>
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      · after &ldquo;{c.title}&rdquo; at {c.client}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
