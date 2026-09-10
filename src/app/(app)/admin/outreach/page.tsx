import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { getOutreachBoard } from "@/lib/data/outreach-links";
import { OutreachForm } from "@/components/marketing/outreach-form";
import { OutreachBoardView } from "@/components/marketing/outreach-board";

/**
 * Link Tracking.
 *
 * Every link the business hands out gets its own code, and everything that
 * happens afterwards is collected against it: who it went to, which room it
 * landed in, whether anybody opened it, whether they answered, whether they
 * booked.
 *
 * The point is the middle of that list. Bookings alone cannot tell a group
 * that never reads comments from a group that reads them and is not sold by
 * the words, and those two need opposite decisions — stop posting there, or
 * write it differently. A click is what separates them.
 */
export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("recommendations", "/marketing");

  const board = await getOutreachBoard().catch((err) => {
    console.error("Link Tracking failed to load:", err);
    return null;
  });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">Link Tracking</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every post, comment and message gets its own link. Screenshot what you are answering and the
          rest fills itself in. From then on the link counts its own opens, and anything that comes of
          it lands against you, against that room, and against the way it was sent.
        </p>
      </header>

      <section className="rounded-lg border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold">Hand out a link</h2>
        <OutreachForm />
      </section>

      {board && board.total.posts > 0 ? (
        <OutreachBoardView board={board} />
      ) : (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          Nothing tracked yet. The next time you answer somebody in a group, record it here first and
          paste the link it gives you.
        </p>
      )}
    </div>
  );
}
