import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { outboundBaseUrl } from "@/lib/base-url";
import { getGroupBoard } from "@/lib/data/community-groups";
import { GroupBoardView } from "@/components/groups/group-board";

/**
 * The neighbourhood groups this business runs.
 *
 * Owning the group in the area you work is the cheapest marketing there is:
 * the people asking "who does this?" are asking in front of you, and the
 * businesses who want to reach them have to come through you.
 *
 * What this page cannot do, said plainly rather than hidden: Facebook
 * discontinued the Groups API on 22 April 2024. No app may read a group's
 * feed, publish to it, approve or decline a pending post, or message somebody
 * who posted — owning the group does not bring any of that back, and every
 * scheduling tool that offered Facebook Groups dropped it the same year.
 * Messenger separately refuses cold messages: the window only opens once a
 * person has messaged the page first.
 *
 * So the blocking is set up once in Facebook's own Admin Assist, from words
 * kept here, and everything Facebook was never going to do — the price of a
 * business post, who paid, what a neighbour asked for and whether anybody
 * answered — is what this page holds.
 */
export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("groups", "/marketing");

  const [board, baseUrl] = await Promise.all([
    getGroupBoard().catch((err) => {
      console.error("Local groups failed to load:", err);
      return null;
    }),
    outboundBaseUrl(),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">Local Groups</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The neighbourhood groups you run. Sort what gets posted in them, answer the people asking
          for work, and charge the businesses who want to advertise.
        </p>
      </header>

      {board ? (
        <GroupBoardView board={board} baseUrl={baseUrl ?? ""} />
      ) : (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          Couldn&apos;t load the groups just now. Reload the page.
        </p>
      )}

      <section className="rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">What Facebook lets an app do</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Facebook discontinued the Groups API on 22 April 2024. Since then no app can read a
          group&apos;s posts, publish to it, or approve and decline what is pending — being the owner
          of the group makes no difference, because the permissions no longer exist to grant. Cold
          messages are separately impossible: Messenger only opens once somebody has messaged the
          page first.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          What still works is Facebook&apos;s own Admin Assist, which declines posts on words you
          choose and shows the author a message you wrote. Each group here prints those settings,
          ready to paste in once. The pricing, the passes and the leads are the half that lives in
          here, where they can actually be counted.
        </p>
      </section>
    </div>
  );
}
