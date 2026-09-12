import { getProgressByToken } from "@/lib/data/public-progress";
import { isSupabaseConfigured } from "@/lib/env";
import { ProgressView } from "@/components/progress/progress-view";

/**
 * A watcher's link. No account, no sign-in — the token is the access.
 *
 * A revoked or unknown token gets the same page as a wrong one: a link that
 * somebody turned off must stop working rather than degrade into a thinner
 * view, and telling the holder which of the two it was tells them something
 * about a project they are no longer on.
 */
export default async function ProgressPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseConfigured) return null;

  const project = await getProgressByToken(token).catch(() => null);

  if (!project) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-20 text-center">
        <p className="text-lg font-semibold">This link isn&apos;t active.</p>
        <p className="text-sm text-muted-foreground">
          Ask whoever shared it with you for a current one.
        </p>
      </div>
    );
  }

  return <ProgressView project={project} />;
}
