import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { getRecommendationBoard } from "@/lib/data/recommendations";
import { RecommendationForm } from "@/components/marketing/recommendation-form";
import { platformLabel } from "@/lib/recommendations";

/**
 * Answering somebody who asked for a landscaper, and knowing whether it worked.
 *
 * A neighbour posts "can anyone recommend a landscaper?" in a Facebook group
 * or on Nextdoor. Somebody on the team replies. That is the cheapest lead this
 * business gets and nothing recorded any of it — not who answered, not where,
 * and not whether a job came out of it.
 *
 * Two halves on one screen. The form, because a person about to answer a post
 * needs the words in under a minute; and the tally, because the point of
 * recording any of it is finding out which groups are worth the trouble.
 */
export const dynamic = "force-dynamic";

export default async function RecommendationsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("recommendations", "/marketing");

  const board = await getRecommendationBoard().catch((err) => {
    console.error("Recommendations failed to load:", err);
    return null;
  });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">Recommendations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Somebody asked for a landscaper in a group. Record where you saw it and you get a link that is
          yours and belongs to that one reply, with wording to paste. Anything that comes of it lands
          against you and against that group.
        </p>
      </header>

      <section className="rounded-lg border border-border p-4">
        <h2 className="mb-3 text-sm font-semibold">Post a recommendation</h2>
        <RecommendationForm />
      </section>

      {board && board.totalPosts > 0 && (
        <>
          <section className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Which groups are worth it</h2>
              <span className="text-xs text-muted-foreground">
                {board.totalBookings} booking{board.totalBookings === 1 ? "" : "s"} from {board.totalPosts}{" "}
                {board.totalPosts === 1 ? "reply" : "replies"}
              </span>
            </div>
            <ul className="flex flex-col gap-2">
              {board.groups.map((group) => (
                <li
                  key={`${group.platform}:${group.groupName}`}
                  className="flex items-baseline justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{group.groupName}</p>
                    <p className="text-xs text-muted-foreground">{platformLabel(group.platform)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums">
                      {group.bookings} / {group.posts}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {group.posts > 0 ? `${Math.round(group.rate * 100)}% booked` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Bookings out of replies. Ordered by bookings rather than by rate — one booking from twenty
              replies beats a perfect record from one.
            </p>
          </section>

          {board.people.length > 1 && (
            <section className="rounded-lg border border-border p-4">
              <h2 className="mb-3 text-sm font-semibold">Who is answering</h2>
              <ul className="flex flex-col gap-1.5">
                {board.people.map((person) => (
                  <li key={person.profileId} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{person.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {person.bookings} from {person.posts}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-3 text-sm font-semibold">Recent replies</h2>
            <ul className="flex flex-col gap-2">
              {board.rows.slice(0, 25).map((row) => (
                <li
                  key={row.id}
                  className="flex items-baseline justify-between gap-3 border-b border-border pb-2 text-sm last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {row.groupName || platformLabel(row.platform)}
                      {row.askedBy && (
                        <span className="ml-1.5 font-normal text-muted-foreground">for {row.askedBy}</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.personName} · {platformLabel(row.platform)} ·{" "}
                      {new Date(row.postedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span
                    className={
                      row.booked
                        ? "shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"
                        : "shrink-0 text-[11px] text-muted-foreground"
                    }
                  >
                    {row.booked ? "Booked" : "No booking yet"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {board && board.totalPosts === 0 && (
        <p className="rounded-lg border border-border bg-card/60 px-3 py-3 text-sm text-muted-foreground">
          Nothing recorded yet. The next time somebody asks for a landscaper in a group, record it here
          first and paste the link it gives you.
        </p>
      )}
    </div>
  );
}
