import Link from "next/link";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { getOutreachBoard } from "@/lib/data/outreach-links";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { OutreachForm } from "@/components/marketing/outreach-form";
import { PLATFORMS, type Platform } from "@/lib/outreach-links";
import { OutreachBoardView } from "@/components/marketing/outreach-board";
import { BookingTestCard } from "@/components/marketing/booking-test-card";
import { getBookingTest } from "@/lib/data/booking-test";

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

export default async function OutreachPage({
  searchParams,
}: {
  searchParams?: Promise<{ text?: string; group?: string; platform?: string }>;
} = {}) {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  // The browser button lands here with the post already on the URL.
  const params = (await searchParams) ?? {};
  const prefill = {
    text: (params.text ?? "").slice(0, 4000) || null,
    group: (params.group ?? "").slice(0, 120) || null,
    platform: PLATFORMS.some((p) => p.key === params.platform) ? (params.platform as Platform) : null,
  };
  await requireTab("recommendations", "/marketing");

  // The owner reads everybody's links and who converted what. Everybody
  // else reads their own: what they handed out, what came back, nothing of
  // anyone else's.
  const profile = await getCurrentProfile();
  const owner = isOwnerLevel(profile?.roles ?? []);
  const [board, bookingTest] = await Promise.all([
    getOutreachBoard(owner ? {} : { onlyProfileId: profile?.id ?? "nobody" }).catch((err) => {
      console.error("Link Tracking failed to load:", err);
      return null;
    }),
    owner ? getBookingTest().catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <header>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold">Link Tracking</h1>
          {owner && (
            <Link href="/admin/outreach/agent" className="text-xs text-muted-foreground hover:underline">
              Group Agent →
            </Link>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Every post, comment and message gets its own link. Screenshot what you are answering and the
          rest fills itself in. From then on the link counts its own opens, and anything that comes of
          it lands against you, against that room, and against the way it was sent.
          {!owner && " This board is yours: your links and what came of them."}
        </p>
      </header>

      <section className="rounded-lg border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold">Hand out a link</h2>
        <OutreachForm prefill={prefill} />
      </section>

      {bookingTest && <BookingTestCard test={bookingTest} />}

      {board && board.total.posts > 0 ? (
        <OutreachBoardView board={board} scope={owner ? "everyone" : "mine"} />
      ) : (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          Nothing tracked yet. The next time you answer somebody in a group, record it here first and
          paste the link it gives you.
        </p>
      )}
    </div>
  );
}
