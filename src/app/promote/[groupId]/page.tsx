import { isSupabaseConfigured } from "@/lib/env";
import { groupPassTerms } from "@/lib/data/community-groups";
import { dollars } from "@/lib/community-groups";
import { BuyPassForm } from "@/components/groups/buy-pass-form";

/**
 * Where a business lands when their post was declined.
 *
 * The group's rule is the whole pitch: the feed is kept clear for neighbours,
 * which is exactly why a post in it is worth paying for. Says the price before
 * asking for anything.
 */
export const dynamic = "force-dynamic";

export default async function PromoteGroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  if (!isSupabaseConfigured) return <NotSelling />;

  const group = await groupPassTerms(groupId).catch(() => null);
  if (!group || group.businessPostCents == null) return <NotSelling />;

  const members = group.memberCount;
  const days = group.passDays;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-10">
      <header className="text-center">
        <h1 className="text-2xl font-bold">Post your business in {group.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {group.area ? `${group.area}. ` : ""}
          {members ? `${members.toLocaleString()} neighbours. ` : ""}
          We keep the feed clear of adverts so people actually read it, which is what makes a post
          in here worth something.
        </p>
      </header>

      <div className="rounded-lg border border-border p-4 text-center">
        <p className="text-3xl font-bold">{dollars(group.businessPostCents)}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          One post, yours to write, good for {days} day{days === 1 ? "" : "s"}.
        </p>
      </div>

      <BuyPassForm groupId={group.id} />

      <p className="text-center text-xs text-muted-foreground">
        You will get a code. Post whenever you like and send us the code, and we approve it.
      </p>
    </div>
  );
}

function NotSelling() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Nothing to buy here</h1>
      <p className="text-sm text-muted-foreground">
        This group isn&apos;t taking business posts at the moment.
      </p>
    </div>
  );
}
