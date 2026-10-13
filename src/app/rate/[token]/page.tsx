import { isSupabaseAdminConfigured } from "@/lib/env";
import { ratingAskByToken } from "@/lib/actions/public-rating-actions";
import { RatingView } from "@/components/reviews/rating-view";

/**
 * Where the review request lands: one question, 1 to 5.
 *
 * No sign-in; the token names one finished job. A five goes on to the
 * business's Google review page. Anything lower asks what to fix and goes to
 * the owner, and the Google link stays on the page, small, because a review
 * ask that hides the public option from unhappy clients breaks Google's rules.
 */
export const dynamic = "force-dynamic";

export default async function RatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isSupabaseAdminConfigured) return <NotActive />;
  const ask = await ratingAskByToken(token).catch(() => null);
  if (!ask) return <NotActive />;
  return <RatingView token={token} ask={ask} />;
}

function NotActive() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-20 text-center">
      <p className="text-lg font-semibold">This link isn&apos;t active.</p>
      <p className="text-sm text-muted-foreground">If you wanted to tell us how the work went, reply to our message. We read every one.</p>
    </div>
  );
}
